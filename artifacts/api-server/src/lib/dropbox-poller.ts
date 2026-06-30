// Dropbox integration via Replit Connectors SDK
// Polls the configured Dropbox folder (stored in DB settings) for new PDF files
// and automatically imports them.
import { ReplitConnectors } from "@replit/connectors-sdk";
import { eq } from "drizzle-orm";
import { db, invoicesTable } from "@workspace/db";
import { getDropboxFolder } from "../routes/settings";
import { extractInvoiceFromPDF } from "./pdf-extractor";
import { logger } from "./logger";

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

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

async function listDropboxPDFs(folder: string): Promise<DropboxEntry[]> {
  const connectors = new ReplitConnectors();
  const response = await connectors.proxy("dropbox", "/2/files/list_folder", {
    method: "POST",
    body: JSON.stringify({ path: folder, recursive: false }),
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Dropbox list_folder ${response.status}: ${text}`);
  }

  const data = (await response.json()) as ListFolderResult;
  return data.entries.filter(
    (e) => e[".tag"] === "file" && e.name.toLowerCase().endsWith(".pdf")
  );
}

async function downloadDropboxFile(pathDisplay: string): Promise<Buffer> {
  // Use get_temporary_link with the full path_display string.
  // id:-based addressing fails for files in shared folder namespaces.
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
    throw new Error(
      `Dropbox get_temporary_link ${linkResponse.status}: ${text}`
    );
  }

  const { link } = (await linkResponse.json()) as {
    link: string;
    metadata: unknown;
  };
  if (!link) throw new Error("No link returned from get_temporary_link");

  const fileResponse = await fetch(link);
  if (!fileResponse.ok) {
    throw new Error(`Temporary link download ${fileResponse.status}`);
  }

  const arrayBuffer = await fileResponse.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export interface SyncResult {
  imported: number;
  skipped: number;
  errors: number;
  folder: string;
}

export async function syncDropbox(): Promise<SyncResult> {
  // Read folder from DB each run so live changes take effect immediately
  const folder = await getDropboxFolder();
  const result: SyncResult = { imported: 0, skipped: 0, errors: 0, folder };

  let files: DropboxEntry[];
  try {
    files = await listDropboxPDFs(folder);
  } catch (err) {
    logger.error({ err }, "Dropbox list_folder failed");
    throw err;
  }

  logger.info({ count: files.length, folder }, "Dropbox: found PDF files");

  for (const file of files) {
    // Skip if already imported (track by Dropbox file ID to survive renames)
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
      const buffer = await downloadDropboxFile(file.path_display);
      const extracted = await extractInvoiceFromPDF(buffer, file.name);

      await db.insert(invoicesTable).values({
        rechnungssteller: extracted.rechnungssteller,
        datum: extracted.datum,
        rechnungsnummer: extracted.rechnungsnummer,
        bruttoBetrag:
          extracted.bruttoBetrag != null ? String(extracted.bruttoBetrag) : null,
        steuersatz:
          extracted.steuersatz != null ? String(extracted.steuersatz) : null,
        steuerBetrag:
          extracted.steuerBetrag != null ? String(extracted.steuerBetrag) : null,
        nettoBetrag:
          extracted.nettoBetrag != null ? String(extracted.nettoBetrag) : null,
        waehrung: extracted.waehrung ?? "EUR",
        bemerkung: extracted.bemerkung,
        dateiname: file.name,
        dropboxFileId: file.id,
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

export function startDropboxPoller(): void {
  // Initial sync on startup
  syncDropbox().catch((err) =>
    logger.error({ err }, "Dropbox: initial sync failed")
  );

  // Poll every 5 minutes
  setInterval(() => {
    syncDropbox().catch((err) =>
      logger.error({ err }, "Dropbox: scheduled sync failed")
    );
  }, POLL_INTERVAL_MS);

  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Dropbox poller started");
}
