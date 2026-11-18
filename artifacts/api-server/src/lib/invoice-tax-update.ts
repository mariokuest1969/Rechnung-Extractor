import { calculateTaxSplit, SPLIT_NET_FIELDS, TaxSplitError } from "@workspace/invoice-tax";

type TaxInput = {
  steuerModus?: "single" | "split";
  netto7?: number | null;
  netto19?: number | null;
  netto0?: number | null;
  bruttoBetrag?: number | null;
  nettoBetrag?: number | null;
  steuerBetrag?: number | null;
  steuersatz?: number | null;
};
type CurrentTax = {
  steuerModus?: string;
  netto7?: string | null;
  netto19?: string | null;
  netto0?: string | null;
};

export function taxUpdate(current: CurrentTax, input: TaxInput): Record<string, string | null> {
  const hasNets = SPLIT_NET_FIELDS.some(key => input[key] !== undefined);
  const mode = input.steuerModus ?? current.steuerModus ?? "single";
  if (mode === "single") {
    if (hasNets) throw new TaxSplitError("Netto 7/19/0 kann nur im Aufteilungsmodus gespeichert werden.");
    return input.steuerModus === "single" ? {
      steuerModus: "single", netto7: null, netto19: null, netto0: null,
      steuer7: null, steuer19: null, steuer0: null,
    } : {};
  }
  if (["bruttoBetrag", "nettoBetrag", "steuerBetrag", "steuersatz"].some(key => input[key as keyof TaxInput] !== undefined))
    throw new TaxSplitError("Bei aktiver Aufteilung bitte nur Netto 7/19/0 ändern. Steuer und Summen werden berechnet.");
  if (current.steuerModus !== "split" && SPLIT_NET_FIELDS.some(key => input[key] === undefined))
    throw new TaxSplitError("Zum Aktivieren bitte alle drei Nettofelder übergeben; nicht verwendete Sätze bleiben leer.");
  if (!hasNets && input.steuerModus === undefined) return {};
  const nets = Object.fromEntries(SPLIT_NET_FIELDS.map(key => [key,
    input[key] !== undefined ? input[key] : current[key] == null ? null : Number(current[key]),
  ])) as Parameters<typeof calculateTaxSplit>[0];
  const calculated = calculateTaxSplit(nets);
  return Object.fromEntries(Object.entries(calculated).map(([key, value]) =>
    [key, value === null ? null : String(value)]));
}
