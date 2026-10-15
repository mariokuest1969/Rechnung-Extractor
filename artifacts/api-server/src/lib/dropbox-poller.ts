// Dropbox integration via Replit Connectors SDK (or direct token if configured)
// Polls the configured Dropbox folder (stored in DB settings) for new PDF files
// and automatically imports them.
import { ReplitConnectors } from "@replit/connectors-sdk";
import { eq, isNotNull, inArray } from "drizzle-orm";
import { db, invoicesTable } from "@workspace/db";
import { getDropboxFolder, getDropboxToken } from "../routes/settings";
import { extractInvoiceFromPDF } from "./pdf-extractor";
import { logger } from "./logger";
import { scanDropboxPDFs, planDropboxBatch, type DropboxEntry } from "./dropbox-scan";
import { assertDropboxConnection, checkDropboxResponse, DropboxAuthError, needsDropboxReconnect } from "./dropbox-connection";

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_FILES_PER_SYNC = 100;

async function waitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();

  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

// ── Low-level Dropbox API call ────────────────────────────────────────────────
// Uses a direct bearer token if provided, otherwise falls back to Replit connector.
export async function dropboxPost(
  endpoint: string,
  body: unknown,
  token: string | null
): Promise<Response> {
  assertDropboxConnection();
  if (token) {
    return checkDropboxResponse(await fetch(`https://api.dropboxapi.com${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }));
  }
  const connectors = new ReplitConnectors();
  return checkDropboxResponse(await connectors.proxy("dropbox", endpoint, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }));
}

// ── List PDFs in a Dropbox folder ─────────────────────────────────────────────
async function listDropboxPDFs(
  folder: string,
  token: string | null
): Promise<DropboxEntry[]> {
  return scanDropboxPDFs(folder, (endpoint, body) => dropboxPost(endpoint, body, token));
}

// ── Download a Dropbox file by path ──────────────────────────────────────────
export async function downloadDropboxFile(
  pathDisplay: string,
  token?: string | null,
  signal?: AbortSignal
): Promise<Buffer> {
  assertDropboxConnection();
  const resolvedToken = token !== undefined ? token : await getDropboxToken();

  if (resolvedToken) {
    // Direct download via content API
    const res = await fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${resolvedToken}`,
        "Dropbox-API-Arg": JSON.stringify({ path: pathDisplay }),
      },
    });
    await checkDropboxResponse(res);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Dropbox download ${res.status}: ${text}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  // Fallback: Replit connector via temporary link
  const connectors = new ReplitConnectors();
  const linkResponse = await waitWithSignal(
    connectors.proxy(
      "dropbox",
      "/2/files/get_temporary_link",
      {
        method: "POST",
        body: JSON.stringify({ path: pathDisplay }),
        headers: { "Content-Type": "application/json" },
      }
    ),
    signal
  );

  await checkDropboxResponse(linkResponse);
  if (!linkResponse.ok) {
    const text = await linkResponse.text();
    throw new Error(`Dropbox get_temporary_link ${linkResponse.status}: ${text}`);
  }

  const { link } = (await linkResponse.json()) as { link: string; metadata: unknown };
  if (!link) throw new Error("No link returned from get_temporary_link");

  const fileResponse = await fetch(link, { signal });
  if (!fileResponse.ok) {
    throw new Error(`Temporary link download ${fileResponse.status}`);
  }
  return Buffer.from(await fileResponse.arrayBuffer());
}

// ── Sync result types ─────────────────────────────────────────────────────────
export interface SyncResult {
  imported: number;
  skipped: number;
  errors: number;
  remaining: number;
  folder: string;
}

export interface CleanupResult {
  removed: number;
  checked: number;
}

// ── Full sync: import new PDFs from Dropbox ───────────────────────────────────
let activeSync: Promise<SyncResult> | null = null;
export function syncDropbox(): Promise<SyncResult> {
  if (!activeSync) activeSync = runDropboxSync().finally(() => { activeSync = null; });
  return activeSync;
}

async function runDropboxSync(): Promise<SyncResult> {
  assertDropboxConnection();
  const folder = await getDropboxFolder();
  const token  = await getDropboxToken();
  const result: SyncResult = { imported: 0, skipped: 0, errors: 0, remaining: 0, folder };

  const files = await listDropboxPDFs(folder, token);

  logger.info({ count: files.length, folder }, "Dropbox: found PDF files");

  const existing = await db.select({ fileId: invoicesTable.dropboxFileId }).from(invoicesTable).where(isNotNull(invoicesTable.dropboxFileId));
  const batch = planDropboxBatch(files, new Set(existing.flatMap(row => row.fileId ? [row.fileId] : [])), MAX_FILES_PER_SYNC);
  result.skipped = batch.skipped;
  result.remaining = batch.remaining;

  for (const file of batch.files) {
    try {
      const buffer    = await downloadDropboxFile(file.path_display);
      const extracted = await extractInvoiceFromPDF(buffer, file.name);

      await db.insert(invoicesTable).values({
        rechnungssteller: extracted.rechnungssteller,
        datum:            extracted.datum,
        rechnungsnummer:  extracted.rechnungsnummer,
        bruttoBetrag:     extracted.bruttoBetrag  != null ? String(extracted.bruttoBetrag)  : null,
        steuersatz:       extracted.steuersatz    != null ? String(extracted.steuersatz)    : null,
        steuerBetrag:     extracted.steuerBetrag  != null ? String(extracted.steuerBetrag)  : null,
        nettoBetrag:      extracted.nettoBetrag   != null ? String(extracted.nettoBetrag)   : null,
        waehrung:         extracted.waehrung ?? "EUR",
        bemerkung:        extracted.bemerkung,
        positionen:        extracted.positionen,
        dateiname:        file.name,
        dropboxFileId:    file.id,
      });

      result.imported++;
      logger.info({ filename: file.name }, "Dropbox: file imported");
    } catch (err) {
      if (err instanceof DropboxAuthError) throw err;
      result.errors++;
      logger.error({ err, filename: file.name }, "Dropbox: failed to import file");
    }
  }

  logger.info(result, "Dropbox sync completed");
  return result;
}

// ── Cleanup: remove DB records for files deleted from Dropbox ─────────────────
export async function cleanupDropbox(): Promise<CleanupResult> {
  assertDropboxConnection();
  const folder = await getDropboxFolder();
  const token  = await getDropboxToken();

  // Get current files in Dropbox
  const currentFiles = await listDropboxPDFs(folder, token);
  const currentIds   = new Set(currentFiles.map((f) => f.id));

  // Get all DB records that came from Dropbox
  const dbRecords = await db
    .select({ id: invoicesTable.id, dropboxFileId: invoicesTable.dropboxFileId })
    .from(invoicesTable)
    .where(isNotNull(invoicesTable.dropboxFileId));

  const orphaned = dbRecords.filter(
    (r) => r.dropboxFileId && !currentIds.has(r.dropboxFileId)
  );

  if (orphaned.length > 0) {
    const orphanedIds = orphaned.map((r) => r.id);
    await db.delete(invoicesTable).where(inArray(invoicesTable.id, orphanedIds));
    logger.info({ removed: orphaned.length }, "Dropbox cleanup: removed orphaned records");
  }

  return { removed: orphaned.length, checked: dbRecords.length };
}

// ── Auto-poller ───────────────────────────────────────────────────────────────
export function startDropboxPoller(): void {
  let running = false;
  const poll = async () => {
    if (running || needsDropboxReconnect()) return;
    running = true;
    try {
      await syncDropbox();
    } catch (err) {
      if (err instanceof DropboxAuthError) {
        logger.warn({ code: err.code }, "Dropbox: reconnect required; automatic sync paused");
      } else {
        logger.error({ err }, "Dropbox: scheduled sync failed");
      }
    } finally { running = false; }
  };
  void poll();
  setInterval(() => void poll(), POLL_INTERVAL_MS);

  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Dropbox poller started");
}
