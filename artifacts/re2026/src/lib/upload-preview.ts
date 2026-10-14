import type { InvoicePreview } from "@workspace/api-client-react";

/** Upload order, not filename, identifies files (filenames can be duplicated). */
export async function extractPreviews(files: File[]): Promise<InvoicePreview[]> {
  try {
    const body = new FormData();
    files.forEach(file => body.append("files", file));
    const response = await fetch("/api/invoices/extract-preview", { method: "POST", body });
    if (!response.ok) throw new Error("Auslesen fehlgeschlagen");
    const results: InvoicePreview[] = await response.json();
    if (!Array.isArray(results) || results.length !== files.length ||
        results.some((result, index) => !result || result.dateiname !== files[index].name ||
          !["success", "error"].includes(result.status) ||
          (result.status === "error" ? typeof result.error !== "string" || !result.error : result.error !== null))) {
      throw new Error("Ungültige Vorschau-Antwort");
    }
    return results;
  } catch {
    return files.map(file => ({
      dateiname: file.name, status: "error",
      error: "Auslesen fehlgeschlagen. Bitte Verbindung und PDF-Datei prüfen und erneut versuchen.",
    }));
  }
}
