import { randomUUID } from "node:crypto";
import { Router, type IRouter, type RequestHandler } from "express";
import multer from "multer";
import { eq, inArray, sql } from "drizzle-orm";
import { db, invoicesTable } from "@workspace/db";
import {
  GetInvoiceParams,
  UpdateInvoiceParams,
  UpdateInvoiceBody,
  DeleteInvoiceParams,
  GetInvoiceStatsResponse,
  ExtractPreviewResponseItem,
} from "@workspace/api-zod";
import { extractInvoiceFromPDF } from "../lib/pdf-extractor";
import { syncDropbox, cleanupDropbox, downloadDropboxFile } from "../lib/dropbox-poller";
import { DropboxAuthError } from "../lib/dropbox-connection";
import { logger } from "../lib/logger";
import { createReextractJob, readReextractJob, commitReextractJob, failReextractJob } from "../lib/reextract-jobs";
import {
  getReextractErrorHttpStatus,
  keepExistingPositionsWhenExtractionIsEmpty,
  withReextractTimeout,
} from "../lib/reextract";

const router: IRouter = Router();
const REEXTRACT_TIMEOUT_MS = 70_000;
function isDatabaseTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "57014" || error.code === "55P03")
  );
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed"));
  },
});

const receivePdfs: RequestHandler = (req, res, next) => {
  upload.array("files")(req, res, (error: unknown) => {
    if (error) {
      res.status(400).json({ error: "Nur PDF-Dateien bis 20 MB sind erlaubt" });
      return;
    }
    next();
  });
};

// Keep legacy confirmed uploads valid, but never accept a failed preview as an invoice.
const confirmedInvoice = UpdateInvoiceBody.extend(ExtractPreviewResponseItem.omit({
  status: true, error: true,
}).shape).extend({
  status: ExtractPreviewResponseItem.shape.status.extract(["success"]).optional(),
  error: ExtractPreviewResponseItem.shape.error.refine(value => value === null).optional(),
});
const confirmedInvoices = confirmedInvoice.array().min(1);
function toInsertInvoice(item: ReturnType<typeof confirmedInvoice.parse>): typeof invoicesTable.$inferInsert {
  const { status: _status, error: _error, ...invoice } = item;
  return {
    ...invoice,
    bruttoBetrag: item.bruttoBetrag == null ? null : String(item.bruttoBetrag),
    nettoBetrag: item.nettoBetrag == null ? null : String(item.nettoBetrag),
    steuerBetrag: item.steuerBetrag == null ? null : String(item.steuerBetrag),
    steuersatz: item.steuersatz == null ? null : String(item.steuersatz),
    buchungskonto1Betrag: item.buchungskonto1Betrag == null ? null : String(item.buchungskonto1Betrag),
    buchungskonto2Betrag: item.buchungskonto2Betrag == null ? null : String(item.buchungskonto2Betrag),
    waehrung: item.waehrung ?? "EUR",
    positionen: (item.positionen ?? []).map(p => ({
      beschreibung: p.beschreibung,
      positionsnummer: p.positionsnummer ?? null,
      menge: p.menge ?? null,
      einheit: p.einheit ?? null,
      einzelpreis: p.einzelpreis ?? null,
      steuersatz: p.steuersatz ?? null,
      nettobetrag: p.nettobetrag ?? null,
      bruttobetrag: p.bruttobetrag ?? null,
    })),
  };
}

function toApiInvoice(row: typeof invoicesTable.$inferSelect) {
  return {
    id: row.id,
    rechnungssteller: row.rechnungssteller ?? null,
    datum: row.datum ?? null,
    rechnungsnummer: row.rechnungsnummer ?? null,
    bruttoBetrag: row.bruttoBetrag != null ? parseFloat(row.bruttoBetrag) : null,
    steuersatz: row.steuersatz != null ? parseFloat(row.steuersatz) : null,
    steuerBetrag: row.steuerBetrag != null ? parseFloat(row.steuerBetrag) : null,
    nettoBetrag: row.nettoBetrag != null ? parseFloat(row.nettoBetrag) : null,
    waehrung: row.waehrung ?? null,
    bemerkung: row.bemerkung ?? null,
    freifeld1: row.freifeld1 ?? null,
    freifeld2: row.freifeld2 ?? null,
    freifeld3: row.freifeld3 ?? null,
    lieferantId: row.lieferantId ?? null,
    buchungskonto1: row.buchungskonto1 ?? null,
    buchungskonto1Betrag: row.buchungskonto1Betrag != null ? parseFloat(row.buchungskonto1Betrag) : null,
    buchungskonto2: row.buchungskonto2 ?? null,
    buchungskonto2Betrag: row.buchungskonto2Betrag != null ? parseFloat(row.buchungskonto2Betrag) : null,
    buchungstext: row.buchungstext ?? null,
    dateiname: row.dateiname ?? null,
    dropboxFileId: row.dropboxFileId ?? null,
    positionen: row.positionen ?? [],
    createdAt: row.createdAt.toISOString(),
  };
}
async function runReextractJob(jobId: string, id: number): Promise<void> {
  try {
    const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
    if (!inv) throw new Error("Rechnung nicht gefunden");
    if (!inv.dropboxFileId) throw new Error("Diese Rechnung hat keine Dropbox-Datei");

    const extracted = await withReextractTimeout(async (signal) => {
      const buffer = await downloadDropboxFile(
        inv.dropboxFileId!,
        undefined,
        signal
      );
      return extractInvoiceFromPDF(
        buffer,
        inv.dateiname ?? inv.dropboxFileId!,
        undefined,
        signal
      );
    }, REEXTRACT_TIMEOUT_MS);

    const extractedPositionCount = extracted.positionen.length;
    await commitReextractJob(jobId, async (tx) => {
      const [row] = await tx.update(invoicesTable).set({
        rechnungssteller: extracted.rechnungssteller ?? inv.rechnungssteller,
        datum: extracted.datum ?? inv.datum,
        rechnungsnummer: extracted.rechnungsnummer ?? inv.rechnungsnummer,
        bruttoBetrag: extracted.bruttoBetrag != null ? String(extracted.bruttoBetrag) : inv.bruttoBetrag,
        steuersatz: extracted.steuersatz != null ? String(extracted.steuersatz) : inv.steuersatz,
        steuerBetrag: extracted.steuerBetrag != null ? String(extracted.steuerBetrag) : inv.steuerBetrag,
        nettoBetrag: extracted.nettoBetrag != null ? String(extracted.nettoBetrag) : inv.nettoBetrag,
        waehrung: extracted.waehrung ?? inv.waehrung,
        bemerkung: extracted.bemerkung ?? inv.bemerkung,
        positionen: keepExistingPositionsWhenExtractionIsEmpty(
          extracted.positionen,
          inv.positionen
        ),
      }).where(eq(invoicesTable.id, id)).returning();
      if (!row) throw new Error("Rechnung nicht gefunden");
      return { invoice: toApiInvoice(row), extractedPositionCount };
    });
  } catch (error) {
    logger.error({ err: error, id, jobId }, "Reextract job failed");
    const httpStatus = getReextractErrorHttpStatus(error, isDatabaseTimeout);
    await failReextractJob(jobId, {
      httpStatus,
      error:
        httpStatus === 504
          ? "Zeitlimit für die Neu-Extraktion überschritten"
          : error instanceof Error
            ? error.message
            : "Neu-Extraktion fehlgeschlagen",
    });
  }
}

// GET /invoices
router.get("/invoices", async (_req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(invoicesTable);
  res.json(rows.map(toApiInvoice));
});

// GET /invoices/stats
router.get("/invoices/stats", async (_req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(invoicesTable);
  const totalInvoices = rows.length;
  const totalBrutto = rows.reduce((s, r) => s + (r.bruttoBetrag != null ? parseFloat(r.bruttoBetrag) : 0), 0);
  const totalNetto = rows.reduce((s, r) => s + (r.nettoBetrag != null ? parseFloat(r.nettoBetrag) : 0), 0);
  const totalSteuer = rows.reduce((s, r) => s + (r.steuerBetrag != null ? parseFloat(r.steuerBetrag) : 0), 0);
  const waehrungMap = new Map<string, { totalBrutto: number; count: number }>();
  for (const r of rows) {
    const w = r.waehrung ?? "EUR";
    const e = waehrungMap.get(w) ?? { totalBrutto: 0, count: 0 };
    e.totalBrutto += r.bruttoBetrag != null ? parseFloat(r.bruttoBetrag) : 0;
    e.count += 1;
    waehrungMap.set(w, e);
  }
  res.json(GetInvoiceStatsResponse.parse({
    totalInvoices,
    totalBrutto: parseFloat(totalBrutto.toFixed(2)),
    totalNetto: parseFloat(totalNetto.toFixed(2)),
    totalSteuer: parseFloat(totalSteuer.toFixed(2)),
    byWaehrung: Array.from(waehrungMap.entries()).map(([w, v]) => ({
      waehrung: w, totalBrutto: parseFloat(v.totalBrutto.toFixed(2)), count: v.count,
    })),
  }));
});

// POST /invoices/upload
router.post("/invoices/upload", receivePdfs, async (req, res): Promise<void> => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) { res.status(400).json({ error: "Keine PDF-Dateien hochgeladen" }); return; }
  const values: (typeof invoicesTable.$inferInsert)[] = [];
  for (const file of files) {
    try {
      const extracted = await extractInvoiceFromPDF(file.buffer, file.originalname);
      values.push(toInsertInvoice(confirmedInvoice.parse({ ...extracted, dateiname: file.originalname })));
    } catch (err) {
      req.log.error({ err, filename: file.originalname }, "Failed to process PDF");
      res.status(422).json({ error: "PDF konnte nicht verarbeitet werden; keine Rechnungen gespeichert", dateiname: file.originalname });
      return;
    }
  }
  const created = await db.insert(invoicesTable).values(values).returning();
  res.json(created.map(toApiInvoice));
});

// POST /invoices/extract-preview — extract without saving
router.post("/invoices/extract-preview", receivePdfs, async (req, res): Promise<void> => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) { res.status(400).json({ error: "Keine PDF-Dateien hochgeladen" }); return; }
  const previews: Record<string, unknown>[] = [];
  for (const file of files) {
    try {
      const extracted = await extractInvoiceFromPDF(file.buffer, file.originalname, undefined, undefined, { strict: true });
      previews.push({ ...extracted, dateiname: file.originalname, status: "success", error: null });
    } catch (err) {
      req.log.error({ err, filename: file.originalname }, "Preview extraction failed");
      previews.push({ dateiname: file.originalname, status: "error", error: "PDF konnte nicht ausgelesen werden. Bitte erneut versuchen oder die Datei prüfen." });
    }
  }
  res.json(previews);
});

// POST /invoices/upload-confirmed — save pre-reviewed invoice data
router.post("/invoices/upload-confirmed", async (req, res): Promise<void> => {
  const body = confirmedInvoices.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const created = await db.insert(invoicesTable).values(body.data.map(toInsertInvoice)).returning();
  res.json(created.map(toApiInvoice));
});

// PATCH /invoices/bulk-update
router.patch("/invoices/bulk-update", async (req, res): Promise<void> => {
  const { ids, fields } = req.body as { ids?: unknown; fields?: unknown };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids muss ein nicht-leeres Array sein" }); return;
  }
  if (typeof fields !== "object" || fields === null) {
    res.status(400).json({ error: "fields ist erforderlich" }); return;
  }
  const f = fields as Record<string, unknown>;
  const update: Record<string, unknown> = {};
  if (f.rechnungssteller !== undefined) update.rechnungssteller = f.rechnungssteller;
  if (f.lieferantId !== undefined) update.lieferantId = f.lieferantId;
  if (f.buchungskonto1 !== undefined) update.buchungskonto1 = f.buchungskonto1;
  if (f.buchungskonto1Betrag !== undefined) update.buchungskonto1Betrag = f.buchungskonto1Betrag != null ? String(f.buchungskonto1Betrag) : null;
  if (f.buchungskonto2 !== undefined) update.buchungskonto2 = f.buchungskonto2;
  if (f.buchungskonto2Betrag !== undefined) update.buchungskonto2Betrag = f.buchungskonto2Betrag != null ? String(f.buchungskonto2Betrag) : null;
  if (f.buchungstext !== undefined) update.buchungstext = f.buchungstext;
  if (f.freifeld1 !== undefined) update.freifeld1 = f.freifeld1;
  if (f.freifeld2 !== undefined) update.freifeld2 = f.freifeld2;
  if (f.freifeld3 !== undefined) update.freifeld3 = f.freifeld3;

  // MwSt-Satz: Steuer + Netto werden pro Rechnung aus dem jeweiligen Brutto neu berechnet
  const hasSteuersatz = f.steuersatz !== undefined && f.steuersatz !== null;
  const rate = hasSteuersatz ? Number(f.steuersatz) : null;
  if (hasSteuersatz && (rate === null || isNaN(rate))) {
    res.status(400).json({ error: "Ungültiger MwSt-Satz" }); return;
  }

  if (Object.keys(update).length === 0 && !hasSteuersatz) {
    res.status(400).json({ error: "Keine Felder zum Aktualisieren" }); return;
  }
  const numericIds = (ids as unknown[]).map(Number).filter((n) => !isNaN(n));

  if (hasSteuersatz && rate !== null) {
    // Pro Rechnung: netto = brutto / (1 + satz/100), steuer = brutto - netto
    const rows = await db
      .select()
      .from(invoicesTable)
      .where(inArray(invoicesTable.id, numericIds));
    for (const inv of rows) {
      const perUpdate: Record<string, unknown> = { ...update, steuersatz: String(rate) };
      const brutto = inv.bruttoBetrag != null ? parseFloat(inv.bruttoBetrag) : null;
      if (brutto != null && !isNaN(brutto)) {
        const netto = rate === 0 ? brutto : brutto / (1 + rate / 100);
        const steuer = brutto - netto;
        perUpdate.nettoBetrag = String(Math.round(netto * 100) / 100);
        perUpdate.steuerBetrag = String(Math.round(steuer * 100) / 100);
      }
      await db.update(invoicesTable).set(perUpdate).where(eq(invoicesTable.id, inv.id));
    }
    res.json({ updated: rows.length });
    return;
  }

  await db.update(invoicesTable).set(update).where(inArray(invoicesTable.id, numericIds));
  res.json({ updated: numericIds.length });
});

// GET /invoices/:id/pdf — stream PDF inline from Dropbox
router.get("/invoices/:id/pdf", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Ungültige ID" }); return; }
  const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  if (!inv) { res.status(404).json({ error: "Rechnung nicht gefunden" }); return; }
  if (!inv.dropboxFileId) { res.status(400).json({ error: "Keine Dropbox-Datei verknüpft" }); return; }
  try {
    const buffer = await downloadDropboxFile(inv.dropboxFileId);
    const filename = (inv.dateiname ?? "rechnung.pdf").replace(/"/g, "");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(buffer);
  } catch (err) {
    req.log.error({ err, id }, "pdf-stream failed");
    res.status(500).json({ error: "Fehler beim Laden der PDF" });
  }
});

// GET /invoices/:id/dropbox-link — return temporary Dropbox download URL
router.get("/invoices/:id/dropbox-link", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Ungültige ID" }); return; }
  const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  if (!inv) { res.status(404).json({ error: "Rechnung nicht gefunden" }); return; }
  if (!inv.dropboxFileId) { res.status(400).json({ error: "Keine Dropbox-Datei verknüpft" }); return; }
  try {
    const { dropboxPost } = await import("../lib/dropbox-poller");
    const { getDropboxToken } = await import("./settings");
    const linkResponse = await dropboxPost("/2/files/get_temporary_link", { path: inv.dropboxFileId }, await getDropboxToken());
    if (!linkResponse.ok) { res.status(500).json({ error: "Dropbox-Link konnte nicht erstellt werden" }); return; }
    const { link } = await linkResponse.json() as { link: string };
    res.json({ url: link });
  } catch (err) {
    req.log.error({ err, id }, "dropbox-link failed");
    res.status(500).json({ error: "Fehler beim Erstellen des Links" });
  }
});

// POST /invoices/:id/reextract — start re-extraction job
router.post("/invoices/:id/reextract", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Ungültige ID" }); return; }
  const jobId = randomUUID();
  await createReextractJob(jobId);
  void runReextractJob(jobId, id).catch((err) => {
    logger.error({ err, jobId }, "Could not persist job failure; lease will expire");
  });
  res.status(202).json({ jobId, status: "processing" });
});

router.get("/invoices/reextract-jobs/:jobId", async (req, res): Promise<void> => {
  const job = await readReextractJob(req.params.jobId as string);
  if (!job) {
    res.status(404).json({ error: "Neu-Extraktionsauftrag nicht gefunden" });
    return;
  }
  res.status(job.status === "error" ? Number(job.httpStatus) : 200).json(job);
});

// POST /invoices/bulk-delete
router.post("/invoices/bulk-delete", async (req, res): Promise<void> => {
  const { ids } = req.body as { ids?: unknown };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids muss ein nicht-leeres Array sein" }); return;
  }
  const numericIds = (ids as unknown[]).map(Number).filter((n) => !isNaN(n));
  await db.delete(invoicesTable).where(inArray(invoicesTable.id, numericIds));
  res.json({ deleted: numericIds.length });
});

// POST /invoices/dropbox-sync
router.post("/invoices/dropbox-sync", async (req, res): Promise<void> => {
  try {
    const result = await syncDropbox();
    res.json(result);
  } catch (err) {
    if (err instanceof DropboxAuthError) {
      res.status(409).json({ error: err.message, code: err.code }); return;
    }
    req.log.error({ err }, "Dropbox sync failed");
    res.status(500).json({ error: "Dropbox-Sync fehlgeschlagen" });
  }
});

// POST /invoices/dropbox-cleanup — remove DB records for files deleted in Dropbox
router.post("/invoices/dropbox-cleanup", async (req, res): Promise<void> => {
  try {
    const result = await cleanupDropbox();
    res.json(result);
  } catch (err) {
    if (err instanceof DropboxAuthError) {
      res.status(409).json({ error: err.message, code: err.code }); return;
    }
    req.log.error({ err }, "Dropbox cleanup failed");
    res.status(500).json({ error: "Dropbox-Bereinigung fehlgeschlagen" });
  }
});

// GET /invoices/:id
router.get("/invoices/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetInvoiceParams.safeParse({ id: rawId });
  if (!params.success || !Number.isSafeInteger(params.data.id) || params.data.id <= 0) { res.status(400).json({ error: "Ungültige ID" }); return; }
  const [row] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, params.data.id));
  if (!row) { res.status(404).json({ error: "Rechnung nicht gefunden" }); return; }
  res.json(toApiInvoice(row));
});

// PATCH /invoices/:id
router.patch("/invoices/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateInvoiceParams.safeParse({ id: rawId });
  if (!params.success || !Number.isSafeInteger(params.data.id) || params.data.id <= 0) { res.status(400).json({ error: "Ungültige ID" }); return; }
  const body = UpdateInvoiceBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const update: Record<string, unknown> = {};
  const d = body.data;
  if (d.rechnungssteller !== undefined) update.rechnungssteller = d.rechnungssteller;
  if (d.datum !== undefined) update.datum = d.datum;
  if (d.rechnungsnummer !== undefined) update.rechnungsnummer = d.rechnungsnummer;
  if (d.bruttoBetrag !== undefined) update.bruttoBetrag = d.bruttoBetrag != null ? String(d.bruttoBetrag) : null;
  if (d.steuersatz !== undefined) update.steuersatz = d.steuersatz != null ? String(d.steuersatz) : null;
  if (d.steuerBetrag !== undefined) update.steuerBetrag = d.steuerBetrag != null ? String(d.steuerBetrag) : null;
  if (d.nettoBetrag !== undefined) update.nettoBetrag = d.nettoBetrag != null ? String(d.nettoBetrag) : null;
  if (d.waehrung !== undefined) update.waehrung = d.waehrung;
  if (d.bemerkung !== undefined) update.bemerkung = d.bemerkung;
  if (d.freifeld1 !== undefined) update.freifeld1 = d.freifeld1;
  if (d.freifeld2 !== undefined) update.freifeld2 = d.freifeld2;
  if (d.freifeld3 !== undefined) update.freifeld3 = d.freifeld3;
  if (d.lieferantId !== undefined) update.lieferantId = d.lieferantId;
  if (d.buchungskonto1 !== undefined) update.buchungskonto1 = d.buchungskonto1;
  if (d.buchungskonto1Betrag !== undefined) update.buchungskonto1Betrag = d.buchungskonto1Betrag != null ? String(d.buchungskonto1Betrag) : null;
  if (d.buchungskonto2 !== undefined) update.buchungskonto2 = d.buchungskonto2;
  if (d.buchungskonto2Betrag !== undefined) update.buchungskonto2Betrag = d.buchungskonto2Betrag != null ? String(d.buchungskonto2Betrag) : null;
  if (d.buchungstext !== undefined) update.buchungstext = d.buchungstext;
  if (Object.keys(update).length === 0) { res.status(400).json({ error: "Keine Felder" }); return; }
  const [row] = await db.update(invoicesTable).set(update).where(eq(invoicesTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Rechnung nicht gefunden" }); return; }
  res.json(toApiInvoice(row));
});

// DELETE /invoices/:id
router.delete("/invoices/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteInvoiceParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) { res.status(400).json({ error: "Ungültige ID" }); return; }
  const [row] = await db.delete(invoicesTable).where(eq(invoicesTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Rechnung nicht gefunden" }); return; }
  res.sendStatus(204);
});

export default router;
