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
import { syncDropbox, downloadDropboxFile } from "../lib/dropbox-poller";
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

// POST /invoices/extract-preview — extract without saving
router.post("/invoices/extract-preview", upload.array("files"), async (req, res): Promise<void> => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) { res.status(400).json({ error: "Keine PDF-Dateien hochgeladen" }); return; }
  const previews: Record<string, unknown>[] = [];
  for (const file of files) {
    try {
      const extracted = await extractInvoiceFromPDF(file.buffer, file.originalname);
      previews.push({ dateiname: file.originalname, ...extracted });
    } catch (err) {
      req.log.error({ err, filename: file.originalname }, "Preview extraction failed");
      previews.push({ dateiname: file.originalname, rechnungssteller: null, datum: null, rechnungsnummer: null, bruttoBetrag: null, steuersatz: null, steuerBetrag: null, nettoBetrag: null, waehrung: "EUR", bemerkung: null });
    }
  }
  res.json(previews);
});

// POST /invoices/upload-confirmed — save pre-reviewed invoice data
router.post("/invoices/upload-confirmed", async (req, res): Promise<void> => {
  const body = req.body as unknown;
  if (!Array.isArray(body) || body.length === 0) { res.status(400).json({ error: "Keine Daten" }); return; }
  const created: ReturnType<typeof toApiInvoice>[] = [];
  for (const item of body as Record<string, unknown>[]) {
    const [row] = await db.insert(invoicesTable).values({
      rechnungssteller: (item.rechnungssteller as string) ?? null,
      datum: (item.datum as string) ?? null,
      rechnungsnummer: (item.rechnungsnummer as string) ?? null,
      bruttoBetrag: item.bruttoBetrag != null ? String(item.bruttoBetrag) : null,
      steuersatz: item.steuersatz != null ? String(item.steuersatz) : null,
      steuerBetrag: item.steuerBetrag != null ? String(item.steuerBetrag) : null,
      nettoBetrag: item.nettoBetrag != null ? String(item.nettoBetrag) : null,
      waehrung: (item.waehrung as string) ?? "EUR",
      bemerkung: (item.bemerkung as string) ?? null,
      dateiname: (item.dateiname as string) ?? null,
    }).returning();
    if (row) created.push(toApiInvoice(row));
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
    const { ReplitConnectors } = await import("@replit/connectors-sdk");
    const connectors = new ReplitConnectors();
    const linkResponse = await connectors.proxy("dropbox", "/2/files/get_temporary_link", {
      method: "POST",
      body: JSON.stringify({ path: inv.dropboxFileId }),
      headers: { "Content-Type": "application/json" },
    });
    if (!linkResponse.ok) { res.status(500).json({ error: "Dropbox-Link konnte nicht erstellt werden" }); return; }
    const { link } = await linkResponse.json() as { link: string };
    res.json({ url: link });
  } catch (err) {
    req.log.error({ err, id }, "dropbox-link failed");
    res.status(500).json({ error: "Fehler beim Erstellen des Links" });
  }
});

// POST /invoices/:id/reextract — re-download from Dropbox and re-run extraction
router.post("/invoices/:id/reextract", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Ungültige ID" }); return; }
  const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  if (!inv) { res.status(404).json({ error: "Rechnung nicht gefunden" }); return; }
  if (!inv.dropboxFileId) { res.status(400).json({ error: "Diese Rechnung hat keine Dropbox-Datei" }); return; }
  try {
    const buffer = await downloadDropboxFile(inv.dropboxFileId);
    const extracted = await extractInvoiceFromPDF(buffer, inv.dateiname ?? inv.dropboxFileId);
    const [updated] = await db.update(invoicesTable).set({
      rechnungssteller: extracted.rechnungssteller ?? inv.rechnungssteller,
      datum: extracted.datum ?? inv.datum,
      rechnungsnummer: extracted.rechnungsnummer ?? inv.rechnungsnummer,
      bruttoBetrag: extracted.bruttoBetrag != null ? String(extracted.bruttoBetrag) : inv.bruttoBetrag,
      steuersatz: extracted.steuersatz != null ? String(extracted.steuersatz) : inv.steuersatz,
      steuerBetrag: extracted.steuerBetrag != null ? String(extracted.steuerBetrag) : inv.steuerBetrag,
      nettoBetrag: extracted.nettoBetrag != null ? String(extracted.nettoBetrag) : inv.nettoBetrag,
      waehrung: extracted.waehrung ?? inv.waehrung,
      bemerkung: extracted.bemerkung ?? inv.bemerkung,
    }).where(eq(invoicesTable.id, id)).returning();
    res.json(toApiInvoice(updated!));
  } catch (err) {
    req.log.error({ err, id }, "Reextract failed");
    res.status(500).json({ error: "Neu-Extraktion fehlgeschlagen" });
  }
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
