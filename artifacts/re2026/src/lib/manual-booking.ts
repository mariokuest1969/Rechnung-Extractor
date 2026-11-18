import type { ManualBookingInput, InvoiceReviewStatus } from "@workspace/api-client-react";
import { calculateTaxSplit } from "@workspace/invoice-tax";
import { validateSingleNumber } from "@/lib/single-edit-validation";

export type BookingDraft = {
  datum: string;
  buchungstext: string;
  waehrung: string;
  rechnungssteller: string;
  rechnungsnummer: string;
  lieferantId: string;
  buchungskonto1: string;
  buchungskonto1Betrag: string;
  buchungskonto2: string;
  buchungskonto2Betrag: string;
  bemerkung: string;
  freifeld1: string;
  freifeld2: string;
  freifeld3: string;
  bearbeitungsstatus: InvoiceReviewStatus;
  steuerModus: "single" | "split";
  bruttoBetrag: string;
  steuersatz: string;
  netto7: string;
  netto19: string;
  netto0: string;
};

/** Today's calendar date in Europe/Berlin as YYYY-MM-DD. */
export function berlinToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function formatGermanDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

export function emptyDraft(): BookingDraft {
  return {
    datum: berlinToday(), buchungstext: "", waehrung: "EUR", rechnungssteller: "", rechnungsnummer: "",
    lieferantId: "", buchungskonto1: "", buchungskonto1Betrag: "", buchungskonto2: "", buchungskonto2Betrag: "",
    bemerkung: "", freifeld1: "", freifeld2: "", freifeld3: "", bearbeitungsstatus: "unreviewed",
    steuerModus: "single", bruttoBetrag: "", steuersatz: "19", netto7: "", netto19: "", netto0: "",
  };
}

const s = (v: unknown) => (v == null ? "" : String(v));

export function draftFromBooking(b: ManualBookingInput): BookingDraft {
  return {
    datum: s(b.datum), buchungstext: s(b.buchungstext), waehrung: s(b.waehrung) || "EUR",
    rechnungssteller: s(b.rechnungssteller), rechnungsnummer: s(b.rechnungsnummer), lieferantId: s(b.lieferantId),
    buchungskonto1: s(b.buchungskonto1), buchungskonto1Betrag: s(b.buchungskonto1Betrag),
    buchungskonto2: s(b.buchungskonto2), buchungskonto2Betrag: s(b.buchungskonto2Betrag),
    bemerkung: s(b.bemerkung), freifeld1: s(b.freifeld1), freifeld2: s(b.freifeld2), freifeld3: s(b.freifeld3),
    bearbeitungsstatus: b.bearbeitungsstatus ?? "unreviewed",
    steuerModus: b.steuerModus === "split" ? "split" : "single",
    bruttoBetrag: s(b.bruttoBetrag), steuersatz: s(b.steuersatz),
    netto7: s(b.netto7), netto19: s(b.netto19), netto0: s(b.netto0),
  };
}

export type DraftErrors = Partial<Record<keyof BookingDraft | "tax", string>>;

/**
 * Single-rate split from gross, identical to the backend: bigint cents,
 * commercial rounding of the absolute value, sign restored, tax = gross - net.
 * Inputs must already be validated to at most two decimals.
 */
export function splitGross(gross: number, rate: number): { nettoBetrag: number; steuerBetrag: number } {
  const grossCents = BigInt(Math.round(gross * 100));
  const rateHundredths = BigInt(Math.round(rate * 100));
  const denominator = 10000n + rateHundredths;
  const negative = grossCents < 0n;
  const absGross = negative ? -grossCents : grossCents;
  const unsignedNet = (absGross * 10000n + denominator / 2n) / denominator;
  const net = negative ? -unsignedNet : unsignedNet;
  return { nettoBetrag: Number(net) / 100, steuerBetrag: Number(grossCents - net) / 100 };
}

/** Builds the API payload. Never rounds user input: more than two decimals is an error. */
export function buildBooking(d: BookingDraft, opts: { includeStatus: boolean }): { data?: ManualBookingInput; errors: DraftErrors } {
  const errors: DraftErrors = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.datum)) errors.datum = "Bitte ein gültiges Datum wählen.";
  if (!d.buchungstext.trim()) errors.buchungstext = "Buchungstext ist erforderlich.";
  else if (d.buchungstext.trim().length > 2000) errors.buchungstext = "Höchstens 2000 Zeichen.";
  const cur = d.waehrung.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) errors.waehrung = "Dreistelliger Währungscode, z. B. EUR.";

  const money = (key: "buchungskonto1Betrag" | "buchungskonto2Betrag" | "bruttoBetrag" | "netto7" | "netto19" | "netto0") => {
    const r = validateSingleNumber("buchungskonto1Betrag", d[key]);
    if (r.error) errors[key] = r.error;
    return r.value;
  };
  const k1 = money("buchungskonto1Betrag");
  const k2 = money("buchungskonto2Betrag");

  const opt = (v: string) => (v.trim() ? v.trim() : null);
  const base: ManualBookingInput = {
    datum: d.datum, buchungstext: d.buchungstext.trim(), waehrung: cur,
    rechnungssteller: opt(d.rechnungssteller), rechnungsnummer: opt(d.rechnungsnummer),
    lieferantId: d.lieferantId ? Number(d.lieferantId) : null,
    buchungskonto1: opt(d.buchungskonto1), buchungskonto1Betrag: k1,
    buchungskonto2: opt(d.buchungskonto2), buchungskonto2Betrag: k2,
    bemerkung: opt(d.bemerkung), freifeld1: opt(d.freifeld1), freifeld2: opt(d.freifeld2), freifeld3: opt(d.freifeld3),
  };
  if (opts.includeStatus) base.bearbeitungsstatus = d.bearbeitungsstatus;

  if (d.steuerModus === "split") {
    const nets = { netto7: money("netto7"), netto19: money("netto19"), netto0: money("netto0") };
    if (!errors.netto7 && !errors.netto19 && !errors.netto0) {
      try { calculateTaxSplit(nets); } catch (e) { errors.tax = (e as Error).message; }
    }
    Object.assign(base, { steuerModus: "split", ...nets });
  } else {
    const brutto = money("bruttoBetrag");
    const rate = validateSingleNumber("steuersatz", d.steuersatz);
    if (rate.error) errors.steuersatz = rate.error;
    else if (rate.value == null) errors.steuersatz = "Steuersatz ist erforderlich (0 ist erlaubt).";
    if (!errors.bruttoBetrag && brutto == null) errors.bruttoBetrag = "Bruttobetrag ist erforderlich (0 ist erlaubt).";
    let steuer: number | null = null; let netto: number | null = null;
    if (brutto != null && rate.value != null && !rate.error) {
      ({ nettoBetrag: netto, steuerBetrag: steuer } = splitGross(brutto, rate.value));
    }
    Object.assign(base, { steuerModus: "single", bruttoBetrag: brutto, steuersatz: rate.value, steuerBetrag: steuer, nettoBetrag: netto });
  }
  return Object.keys(errors).length ? { errors } : { data: base, errors };
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { data?: { error?: unknown } })?.data;
  const e = data?.error;
  if (typeof e === "string") {
    try {
      const parsed = JSON.parse(e);
      if (Array.isArray(parsed)) return parsed.map((i: { path?: unknown[]; message?: string }) => `${(i.path ?? []).join(".")}: ${i.message ?? ""}`).join(" · ");
    } catch { /* plain text */ }
    return e;
  }
  if (Array.isArray(e)) return e.map((i: { message?: string }) => i.message ?? "").join(" · ");
  return fallback;
}

export const INTERVAL_LABELS: Record<1 | 3 | 12, string> = { 1: "Monatlich", 3: "Vierteljährlich", 12: "Jährlich" };
export const TEMPLATE_STATUS_LABELS = { active: "Aktiv", paused: "Pausiert", ended: "Beendet" } as const;
