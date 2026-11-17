import { TAX_NUMBER_ERROR, TAX_RANGE_ERROR, TAX_PRECISION_ERROR } from "./bulk-edit-validation";

export type SingleNumericField = "steuersatz" | "buchungskonto1Betrag" | "buchungskonto2Betrag";
export const BOOKING_RANGE_ERROR = "Der Betrag muss zwischen -9.999.999.999,99 und 9.999.999.999,99 liegen.";
export const BOOKING_NUMBER_ERROR = "Bitte einen vollständigen Betrag eingeben, z. B. -123,45.";

export function validateSingleNumber(field: SingleNumericField, input: string | null): { value: number | null; error?: string } {
  const text = input?.trim().replace(",", ".") ?? "";
  if (!text) return { value: null };
  const tax = field === "steuersatz";
  const value = Number(text);
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text) || !Number.isFinite(value))
    return { value: null, error: tax ? TAX_NUMBER_ERROR : BOOKING_NUMBER_ERROR };
  if (value < (tax ? 0 : -9999999999.99) || value > (tax ? 100 : 9999999999.99))
    return { value: null, error: tax ? TAX_RANGE_ERROR : BOOKING_RANGE_ERROR };
  if ((text.split(".")[1]?.length ?? 0) > 2)
    return { value: null, error: TAX_PRECISION_ERROR };
  return { value };
}

export function singleEditError(error: unknown, field: SingleNumericField): string {
  const fallback = "Nicht gespeichert. Bitte erneut versuchen. Ihre Eingabe bleibt erhalten.";
  if (!error || typeof error !== "object") return fallback;
  const { status, data } = error as { status?: number; data?: { error?: unknown } };
  if (status !== 400 && status !== 422) return fallback;
  let issues = data?.error;
  if (typeof issues === "string") {
    try { issues = JSON.parse(issues); } catch { /* use readable fallback */ }
  }
  if (Array.isArray(issues)) {
    const issue = issues.find((i) => Array.isArray(i?.path) && i.path.includes(field));
    if (issue?.code === "too_small" || issue?.code === "too_big")
      return field === "steuersatz" ? TAX_RANGE_ERROR : BOOKING_RANGE_ERROR;
    if (issue?.code === "custom" || issue?.code === "not_multiple_of") return TAX_PRECISION_ERROR;
  }
  return "Nicht gespeichert. Bitte einen gültigen Wert mit höchstens zwei Nachkommastellen eingeben und erneut versuchen.";
}
