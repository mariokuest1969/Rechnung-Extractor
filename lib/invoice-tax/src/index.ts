export const SPLIT_NET_FIELDS = ["netto7", "netto19", "netto0"] as const;
export type SplitNetField = typeof SPLIT_NET_FIELDS[number];
export type SplitNets = Record<SplitNetField, number | null>;
const MAX_CENTS = 999_999_999_999n;

export class TaxSplitError extends Error {}

function cents(value: number | null, label: string): bigint | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value !== Number(value.toFixed(2)))
    throw new TaxSplitError(`${label}: Bitte einen Betrag mit höchstens zwei Nachkommastellen eingeben.`);
  const result = BigInt(Math.round(value * 100));
  if (result < -MAX_CENTS || result > MAX_CENTS)
    throw new TaxSplitError(`${label}: Der Betrag darf höchstens 9.999.999.999,99 betragen (auch negativ).`);
  return result;
}

function amount(value: bigint, label: string): number {
  if (value < -MAX_CENTS || value > MAX_CENTS)
    throw new TaxSplitError(`${label}: Die berechnete Summe überschreitet den erlaubten Betragsbereich.`);
  return Number(value) / 100;
}

// Commercial rounding, including negative half-cents (credit notes).
function tax(net: bigint | null, rate: bigint): bigint | null {
  if (net === null) return null;
  const product = net * rate;
  return (product < 0n ? -1n : 1n) * ((product < 0n ? -product : product) + 50n) / 100n;
}

export function calculateTaxSplit(nets: SplitNets) {
  const n7 = cents(nets.netto7, "Netto 7 %");
  const n19 = cents(nets.netto19, "Netto 19 %");
  const n0 = cents(nets.netto0, "Netto 0 %");
  if (n7 === null && n19 === null && n0 === null)
    throw new TaxSplitError("Bitte mindestens einen Nettobetrag eingeben. 0 ist erlaubt; leer bedeutet nicht angegeben.");
  const t7 = tax(n7, 7n);
  const t19 = tax(n19, 19n);
  const t0 = tax(n0, 0n);
  const net = (n7 ?? 0n) + (n19 ?? 0n) + (n0 ?? 0n);
  const totalTax = (t7 ?? 0n) + (t19 ?? 0n);
  return {
    ...nets,
    steuer7: t7 === null ? null : amount(t7, "Steuer 7 %"),
    steuer19: t19 === null ? null : amount(t19, "Steuer 19 %"),
    steuer0: t0 === null ? null : 0,
    nettoBetrag: amount(net, "Gesamtnetto"),
    steuerBetrag: amount(totalTax, "Gesamtsteuer"),
    bruttoBetrag: amount(net + totalTax, "Gesamtbrutto"),
    steuersatz: null,
    steuerModus: "split" as const,
  };
}
