import { CreateManualBookingBody } from "@workspace/api-zod";
import { calculateTaxSplit, TaxSplitError } from "@workspace/invoice-tax";
import type { invoicesTable } from "@workspace/db";
import { validCalendarDate } from "./booking-calendar";

export class BookingInputError extends Error {}

export function validateBooking(raw: unknown) {
  const result = CreateManualBookingBody.safeParse(raw);
  if (!result.success) throw new BookingInputError("Bitte Datum, Buchungstext, Währung und gültige Beträge eingeben.");
  const input = result.data;
  if (!validCalendarDate(input.datum) || !input.buchungstext.trim())
    throw new BookingInputError("Bitte ein gültiges Datum und einen Buchungstext eingeben.");
  const amounts = ["bruttoBetrag", "nettoBetrag", "steuerBetrag", "netto7", "netto19", "netto0", "buchungskonto1Betrag", "buchungskonto2Betrag"] as const;
  for (const key of amounts) {
    const value = input[key];
    if (value != null && (!Number.isFinite(value) || value !== Number(value.toFixed(2)) || Math.abs(value) > 9_999_999_999.99))
      throw new BookingInputError(`${key}: Höchstens zwei Nachkommastellen und maximal 9.999.999.999,99 sind erlaubt.`);
  }
  if (input.steuerModus === "split") {
    try {
      calculateTaxSplit({ netto7: input.netto7 ?? null, netto19: input.netto19 ?? null, netto0: input.netto0 ?? null });
    } catch (error) {
      if (error instanceof TaxSplitError) throw new BookingInputError(error.message);
      throw error;
    }
  } else {
    if (input.bruttoBetrag == null || input.steuersatz == null || input.steuersatz < 0 || input.steuersatz > 100
      || input.steuersatz !== Number(input.steuersatz.toFixed(2)))
      throw new BookingInputError("Bitte Bruttobetrag und einen Steuersatz von 0 bis 100 mit höchstens zwei Nachkommastellen eingeben.");
    if ([input.netto7, input.netto19, input.netto0].some(v => v != null))
      throw new BookingInputError("Netto 7/19/0 ist nur bei Nettoaufteilung erlaubt.");
  }
  return { ...input, buchungstext: input.buchungstext.trim() };
}

export function bookingValues(raw: unknown): typeof invoicesTable.$inferInsert {
  const input = validateBooking(raw);
  // Whitelist scalar fields. Never accept file links, origin or occurrence IDs.
  const values: typeof invoicesTable.$inferInsert = {
    herkunft: "manual", datum: input.datum, buchungstext: input.buchungstext,
    waehrung: input.waehrung, bearbeitungsstatus: input.bearbeitungsstatus ?? "unreviewed",
  };
  for (const key of ["rechnungssteller", "rechnungsnummer", "bemerkung", "freifeld1", "freifeld2", "freifeld3", "buchungskonto1", "buchungskonto2"] as const)
    values[key] = input[key] ?? null;
  values.lieferantId = input.lieferantId ?? null;
  for (const key of ["buchungskonto1Betrag", "buchungskonto2Betrag"] as const)
    values[key] = input[key] == null ? null : String(input[key]);
  if (input.steuerModus === "split") {
    const calculated = calculateTaxSplit({ netto7: input.netto7 ?? null, netto19: input.netto19 ?? null, netto0: input.netto0 ?? null });
    for (const key of ["netto7", "netto19", "netto0", "steuer7", "steuer19", "steuer0", "nettoBetrag", "steuerBetrag", "bruttoBetrag", "steuersatz"] as const)
      values[key] = calculated[key] == null ? null : String(calculated[key]);
    values.steuerModus = "split";
  } else {
    const gross = Math.round(input.bruttoBetrag! * 100);
    // Commercial rounding, including negative credits.
    const denominator = 10000n + BigInt(Math.round(input.steuersatz! * 100));
    const unsignedNet = (BigInt(Math.abs(gross)) * 10000n + denominator / 2n) / denominator;
    const net = Math.sign(gross) * Number(unsignedNet);
    values.bruttoBetrag = (gross / 100).toFixed(2);
    values.nettoBetrag = (net / 100).toFixed(2);
    values.steuerBetrag = ((gross - net) / 100).toFixed(2);
    values.steuersatz = String(input.steuersatz);
    values.steuerModus = "single";
  }
  return values;
}
