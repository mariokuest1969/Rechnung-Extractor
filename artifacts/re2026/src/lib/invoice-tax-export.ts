import type { Invoice } from "@workspace/api-client-react";

export const TAX_EXPORT_HEADERS = ["Steuermodus", "Netto 7 %", "Netto 19 %", "Netto 0 %", "Steuer 7 %", "Steuer 19 %", "Steuer 0 %"];

export function invoiceTaxExportValues(invoice: Invoice): (string | number)[] {
  return [
    invoice.steuerModus === "split" ? "Nettoaufteilung" : "Einzelsteuer / ohne Aufteilung",
    ...(["netto7", "netto19", "netto0", "steuer7", "steuer19", "steuer0"] as const)
      .map(key => invoice.steuerModus === "split" ? invoice[key] ?? "" : ""),
  ];
}
