import type { InvoicePreview } from "@workspace/api-client-react";

/** Upload order, not filename, identifies files (filenames can be duplicated). */
export async function extractPreviews(files: File[], timeoutMs = 80_000): Promise<InvoicePreview[]> {
  const results: InvoicePreview[] = [];
  // Separate requests retain completed results even if another file or connection hangs.
  // Sequential requests also avoid flooding OCR/AI with a large upload selection.
  for (const file of files) results.push(await extractPreview(file, timeoutMs));
  return results;
}

async function extractPreview(file: File, timeoutMs: number): Promise<InvoicePreview> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = new FormData();
    body.append("files", file);
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Preview timeout"));
      }, timeoutMs);
    });
    const results = await Promise.race([deadline, (async (): Promise<InvoicePreview[]> => {
      const response = await fetch("/api/invoices/extract-preview", { method: "POST", body, signal: controller.signal });
      if (!response.ok) throw new Error("Auslesen fehlgeschlagen");
      const results: InvoicePreview[] = await response.json();
      if (!Array.isArray(results) || results.length !== 1 ||
          results.some((result) => !result || result.dateiname !== file.name ||
            !["success", "error"].includes(result.status) ||
            (result.status === "error" ? typeof result.error !== "string" || !result.error : result.error !== null))) {
        throw new Error("Ungültige Vorschau-Antwort");
      }
      return results;
    })()]);
    return results[0];
  } catch {
    return {
      dateiname: file.name, status: "error",
      error: controller.signal.aborted
        ? "Zeitüberschreitung beim Auslesen. Bitte diese Datei erneut auslesen."
        : "Auslesen fehlgeschlagen. Bitte Verbindung und PDF-Datei prüfen und erneut versuchen.",
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
