// Dropbox integration via Replit Connectors SDK (or direct token if configured)
// Polls the configured Dropbox folder (stored in DB settings) for new PDF files
// and automatically imports them.
import { ReplitConnectors } from "@replit/connectors-sdk";
import { eq, isNotNull, inArray } from "drizzle-orm";
import { db, invoicesTable } from "@workspace/db";
import { getDropboxFolder, getDropboxToken } from "../routes/settings";
import { extractInvoiceFromPDF } from "./pdf-extractor";
import { logger } from "./logger";

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_FILES_PER_SYNC = 100;

interface DropboxEntry {
  ".tag": string;
  name: string;
  id: string;
  path_lower: string;
  path_display: string;
}

interface ListFolderResult {
  entries: DropboxEntry[];
  has_more: boolean;
  cursor: string;
}

// ── Low-level Dropbox API call ────────────────────────────────────────────────
// Uses a direct bearer token if provided, otherwise falls back to Replit connector.
async function dropboxPost(
  endpoint: string,
  body: unknown,
  token: string | null
): Promise<Response> {
  if (token) {
    return fetch(`https://api.dropboxapi.com${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }
  const connectors = new ReplitConnectors();
  return connectors.proxy("dropbox", endpoint, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

// ── List PDFs in a Dropbox folder ─────────────────────────────────────────────
async function listDropboxPDFs(
  folder: string,
  token: string | null
): Promise<DropboxEntry[]> {
  let response = await dropboxPost(
    "/2/files/list_folder",
    { path: folder, recursive: true },
    token
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Dropbox list_folder ${response.status}: ${text}`);
  }

  let data = (await response.json()) as ListFolderResult;
  const entries = [...data.entries];

  while (data.has_more) {
    response = await dropboxPost(
      "/2/files/list_folder/continue",
      { cursor: data.cursor },
      token
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Dropbox list_folder/continue ${response.status}: ${text}`
      );
    }

    data = (await response.json()) as ListFolderResult;
    entries.push(...data.entries);
  }

  return entries.filter(
    (e) => e[".tag"] === "file" && e.name.toLowerCase().endsWith(".pdf")
  );
}

// ── Download a Dropbox file by path ──────────────────────────────────────────
export async function downloadDropboxFile(
  pathDisplay: string,
  token?: string | null
): Promise<Buffer> {
  const resolvedToken = token !== undefined ? token : await getDropboxToken();

  if (resolvedToken) {
    // Direct download via content API
    const res = await fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resolvedToken}`,
        "Dropbox-API-Arg": JSON.stringify({ path: pathDisplay }),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Dropbox download ${res.status}: ${text}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  // Fallback: Replit connector via temporary link
  const connectors = new ReplitConnectors();
  const linkResponse = await connectors.proxy(
    "dropbox",
    "/2/files/get_temporary_link",
    {
      method: "POST",
      body: JSON.stringify({ path: pathDisplay }),
      headers: { "Content-Type": "application/json" },
    }
  );

  if (!linkResponse.ok) {
    const text = await linkResponse.text();
    throw new Error(`Dropbox get_temporary_link ${linkResponse.status}: ${text}`);
  }

  const { link } = (await linkResponse.json()) as { link: string; metadata: unknown };
  if (!link) throw new Error("No link returned from get_temporary_link");

  const fileResponse = await fetch(link);
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
  folder: string;
}

export interface CleanupResult {
  removed: number;
  checked: number;
}

// ── Full sync: import new PDFs from Dropbox ───────────────────────────────────
export async function syncDropbox(): Promise<SyncResult> {
  const folder = await getDropboxFolder();
  const token  = await getDropboxToken();
  const result: SyncResult = { imported: 0, skipped: 0, errors: 0, folder };

  let files: DropboxEntry[];
  try {
    files = await listDropboxPDFs(folder, token);
  } catch (err) {
    logger.error({ err }, "Dropbox list_folder failed");
    throw err;
  }

  logger.info({ count: files.length, folder }, "Dropbox: found PDF files");

  if (files.length > MAX_FILES_PER_SYNC) {
    throw new Error(
      `Dropbox sync stopped: ${files.length} PDFs found below ${folder}. Configure a more specific invoice folder (maximum ${MAX_FILES_PER_SYNC} PDFs per sync).`
    );
  }

  for (const file of files) {
    const existing = await db
      .select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(eq(invoicesTable.dropboxFileId, file.id))
      .limit(1);

    if (existing.length > 0) {
      result.skipped++;
      continue;
    }

    try {
      const buffer    = await downloadDropboxFile(file.path_display, token);
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
      result.errors++;
      logger.error({ err, filename: file.name }, "Dropbox: failed to import file");
    }
  }

  logger.info(result, "Dropbox sync completed");
  return result;
}

// ── Cleanup: remove DB records for files deleted from Dropbox ─────────────────
export async function cleanupDropbox(): Promise<CleanupResult> {
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
  syncDropbox().catch((err) =>
    logger.error({ err }, "Dropbox: initial sync failed")
  );

  setInterval(() => {
    syncDropbox().catch((err) =>
      logger.error({ err }, "Dropbox: scheduled sync failed")
    );
  }, POLL_INTERVAL_MS);

  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Dropbox poller started");
}
