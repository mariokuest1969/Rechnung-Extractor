export interface DropboxEntry {
  ".tag": string;
  name: string;
  id: string;
  path_lower: string;
  path_display: string;
}
interface FolderPage {
  entries: DropboxEntry[];
  has_more: boolean;
  cursor: string;
}

/** Dropbox's recursive listing includes all descendant folders; follow every page. */
export async function scanDropboxPDFs(folder: string, post: (endpoint: string, body: unknown) => Promise<Response>): Promise<DropboxEntry[]> {
  let endpoint = "/2/files/list_folder";
  let body: unknown = { path: folder, recursive: true };
  const files = new Map<string, DropboxEntry>();
  for (;;) {
    const response = await post(endpoint, body);
    if (!response.ok) throw new Error(`Dropbox-Ordnersuche fehlgeschlagen (HTTP ${response.status}).`);
    const page = await response.json() as FolderPage;
    for (const entry of page.entries) {
      if (entry[".tag"] === "file" && entry.name.toLowerCase().endsWith(".pdf")) files.set(entry.id, entry);
    }
    if (!page.has_more) return [...files.values()];
    endpoint = "/2/files/list_folder/continue";
    body = { cursor: page.cursor };
  }
}

export function planDropboxBatch(files: DropboxEntry[], existingIds: ReadonlySet<string>, limit: number) {
  const pending = files.filter(file => !existingIds.has(file.id));
  return { files: pending.slice(0, limit), skipped: files.length - pending.length, remaining: Math.max(0, pending.length - limit) };
}
