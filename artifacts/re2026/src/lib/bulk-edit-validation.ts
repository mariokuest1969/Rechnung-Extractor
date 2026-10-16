export const TAX_NUMBER_ERROR = "Bitte eine vollständige Zahl eingeben, z. B. 19 oder 7,5.";
export const TAX_RANGE_ERROR = "Der Steuersatz muss zwischen 0 und 100 % liegen.";
export const TAX_PRECISION_ERROR = "Bitte höchstens zwei Nachkommastellen eingeben.";

export function validateBulkTaxRate(input: string): { value?: number; error?: string } {
  const text = input.trim().replace(",", ".");
  if (!text) return {};
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return { error: TAX_NUMBER_ERROR };
  const value = Number(text);
  if (!Number.isFinite(value)) return { error: TAX_NUMBER_ERROR };
  if (value < 0 || value > 100) return { error: TAX_RANGE_ERROR };
  if (value !== Number(value.toFixed(2))) return { error: TAX_PRECISION_ERROR };
  return { value };
}

const fieldLabels: Record<string, string> = {
  rechnungssteller: "Rechnungssteller",
  lieferantId: "Lieferant",
  steuersatz: "MwSt %",
  freifeld1: "Feld 1",
  freifeld2: "Feld 2",
  freifeld3: "Feld 3",
};

/** The API wraps Zod issues as a JSON string in data.error. Never show that raw JSON. */
export function describeBulkEditError(error: unknown): { message: string; taxError?: string } {
  const fallback = "Die Änderungen konnten nicht gespeichert werden. Bitte erneut versuchen.";
  if (!error || typeof error !== "object") return { message: fallback };
  const { status, data } = error as { status?: number; data?: { error?: unknown } };
  if (status === 401 || status === 403) return { message: "Keine Berechtigung zum Speichern. Bitte Anmeldung und Zugriffsrechte prüfen." };
  if (status !== 400 && status !== 422) return { message: fallback };
  let issues: unknown = data?.error;
  if (typeof issues === "string") {
    try { issues = JSON.parse(issues); } catch {
      return { message: "Die Eingaben wurden nicht akzeptiert. Bitte die Felder und die Rechnungsauswahl prüfen." };
    }
  }
  if (!Array.isArray(issues)) return { message: "Bitte die Eingaben und die Rechnungsauswahl prüfen." };
  let taxError: string | undefined;
  const messages = issues.map((issue: unknown) => {
    if (!issue || typeof issue !== "object") return "Bitte die Eingaben prüfen.";
    const { path, code } = issue as { path?: unknown; code?: string };
    const field = Array.isArray(path) ? path.find((part) => typeof part === "string" && part in fieldLabels) : undefined;
    if (field === "steuersatz") {
      taxError = code === "too_small" || code === "too_big" ? TAX_RANGE_ERROR
        : code === "not_multiple_of" || code === "custom" ? TAX_PRECISION_ERROR : TAX_NUMBER_ERROR;
      return `MwSt %: ${taxError}`;
    }
    return field ? `${fieldLabels[field]}: Bitte einen gültigen Wert angeben.` : "Bitte die Eingaben und die Rechnungsauswahl prüfen.";
  });
  return { message: [...new Set(messages)].join(" ") || "Bitte die Eingaben prüfen.", taxError };
}
