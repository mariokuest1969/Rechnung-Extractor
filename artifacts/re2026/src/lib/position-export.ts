import type { Invoice } from "@workspace/api-client-react";

export const POSITION_EXPORT_HEADERS = [
  "Dateiname",
  "Rechnungssteller",
  "Datum",
  "Rechnungsnummer",
  "Positionsnummer",
  "Beschreibung",
  "Menge",
  "Einheit",
  "Einzelpreis",
  "Steuersatz",
  "Netto",
  "Brutto",
  "Währung",
] as const;

const POSITION_XLSX_HEADERS = [
  "Dateiname",
  "Rechnungssteller",
  "Datum",
  "Rechnungsnummer",
  "Positionsnummer",
  "Beschreibung",
  "Menge",
  "Einheit",
  "Einzelpreis",
  "MwSt %",
  "Netto",
  "Brutto",
  "Währung",
] as const;

export function createPositionExportRows(invoices: Invoice[]): unknown[][] {
  return invoices.flatMap((invoice) =>
    (invoice.positionen ?? []).map((position) => [
      invoice.dateiname ?? "",
      invoice.rechnungssteller ?? "",
      invoice.datum ?? "",
      invoice.rechnungsnummer ?? "",
      position.positionsnummer ?? "",
      position.beschreibung,
      position.menge ?? "",
      position.einheit ?? "",
      position.einzelpreis ?? "",
      position.steuersatz ?? "",
      position.nettobetrag ?? "",
      position.bruttobetrag ?? "",
      invoice.waehrung ?? "EUR",
    ])
  );
}

export function createPositionExportObjects(
  invoices: Invoice[]
): Record<string, unknown>[] {
  return createPositionExportRows(invoices).map((row) =>
    Object.fromEntries(POSITION_XLSX_HEADERS.map((header, index) => [header, row[index]]))
  );
}