import { Router, type IRouter } from "express";
import multer from "multer";
import { eq, inArray } from "drizzle-orm";
import { db, invoicesTable } from "@workspace/db";
import {
  GetInvoiceParams,
  UpdateInvoiceParams,
  UpdateInvoiceBody,
  DeleteInvoiceParams,
  GetInvoiceStatsResponse,
} from "@workspace/api-zod";
import { extractInvoiceFromPDF } from "../lib/pdf-extractor";
import { syncDropbox } from "../lib/dropbox-poller";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed"));
  },
});

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
    createdAt: row.createdAt.toISOString(),
  };
}

// GET /invoices
router.get("/invoices", async (_req, res): Promise<void> => {
  const rows = await db.select().from(invoicesTable).orderBy(invoicesTable.createdAt);
  res.json(rows.map(toApiInvoice));
});

// GET /invoices/stats
router.get("/invoices/stats", async (_req, res): Promise<void> => {
  const rows = await db.select().from(invoicesTable);
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
router.post("/invoices/upload", upload.array("files"), async (req, res): Promise<void> => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) { res.status(400).json({ error: "Keine PDF-Dateien hochgeladen" }); return; }
  const created: ReturnType<typeof toApiInvoice>[] = [];
  for (const file of files) {
    try {
      const extracted = await extractInvoiceFromPDF(file.buffer, file.originalname);
      const [row] = await db.insert(invoicesTable).values({
        rechnungssteller: extracted.rechnungssteller,
        datum: extracted.datum,
        rechnungsnummer: extracted.rechnungsnummer,
        bruttoBetrag: extracted.bruttoBetrag != null ? String(extracted.bruttoBetrag) : null,
        steuersatz: extracted.steuersatz != null ? String(extracted.steuersatz) : null,
        steuerBetrag: extracted.steuerBetrag != null ? String(extracted.steuerBetrag) : null,
        nettoBetrag: extracted.nettoBetrag != null ? String(extracted.nettoBetrag) : null,
        waehrung: extracted.waehrung ?? "EUR",
        bemerkung: extracted.bemerkung,
        dateiname: file.originalname,
      }).returning();
      created.push(toApiInvoice(row));
    } catch (err) {
      req.log.error({ err, filename: file.originalname }, "Failed to process PDF");
    }
  }
  res.json(created);
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
  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: "Keine Felder zum Aktualisieren" }); return;
  }
  const numericIds = (ids as unknown[]).map(Number).filter((n) => !isNaN(n));
  await db.update(invoicesTable).set(update).where(inArray(invoicesTable.id, numericIds));
  res.json({ updated: numericIds.length });
});

// POST /invoices/dropbox-sync
router.post("/invoices/dropbox-sync", async (req, res): Promise<void> => {
  try {
    const result = await syncDropbox();
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Dropbox sync failed");
    res.status(500).json({ error: "Dropbox-Sync fehlgeschlagen" });
  }
});

// GET /invoices/:id
router.get("/invoices/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetInvoiceParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) { res.status(400).json({ error: "Ungültige ID" }); return; }
  const [row] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, params.data.id));
  if (!row) { res.status(404).json({ error: "Rechnung nicht gefunden" }); return; }
  res.json(toApiInvoice(row));
});

// PATCH /invoices/:id
router.patch("/invoices/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateInvoiceParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) { res.status(400).json({ error: "Ungültige ID" }); return; }
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
