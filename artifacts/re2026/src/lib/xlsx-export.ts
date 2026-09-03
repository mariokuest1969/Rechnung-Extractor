import * as XLSX from "xlsx";
import { Invoice } from "@workspace/api-client-react";

export function exportInvoicesToXLSX(invoices: Invoice[]) {
  const rows = invoices.map((inv) => ({
    Dateiname:         inv.dateiname ?? "",
    Rechnungssteller:  inv.rechnungssteller ?? "",
    Datum:             inv.datum ?? "",
    Rechnungsnummer:   inv.rechnungsnummer ?? "",
    "Brutto (€)":      inv.bruttoBetrag ?? "",
    "MwSt %":          inv.steuersatz ?? "",
    "Steuer (€)":      inv.steuerBetrag ?? "",
    "Netto (€)":       inv.nettoBetrag ?? "",
    Währung:           inv.waehrung ?? "EUR",
    Buchungstext:      inv.buchungstext ?? "",
    Bemerkung:         inv.bemerkung ?? "",
    "Feld 1":          inv.freifeld1 ?? "",
    "Feld 2":          inv.freifeld2 ?? "",
    "Feld 3":          inv.freifeld3 ?? "",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);

  // Column widths
  ws["!cols"] = [
    { wch: 36 }, // Dateiname
    { wch: 28 }, // Rechnungssteller
    { wch: 12 }, // Datum
    { wch: 20 }, // Rechnungsnummer
    { wch: 14 }, // Brutto
    { wch: 8  }, // MwSt %
    { wch: 14 }, // Steuer
    { wch: 14 }, // Netto
    { wch: 8  }, // Währung
    { wch: 24 }, // Buchungstext
    { wch: 24 }, // Bemerkung
    { wch: 16 }, // Feld 1
    { wch: 16 }, // Feld 2
    { wch: 16 }, // Feld 3
  ];

  // Freeze header row
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Rechnungen");

  const filename = `rechnungen_export_${new Date().toISOString().split("T")[0]}.xlsx`;
  XLSX.writeFile(wb, filename);
}

export function exportInvoicePositionsToXLSX(invoices: Invoice[]): number {
  const rows = invoices.flatMap((invoice) =>
    (invoice.positionen ?? []).map((position) => ({
      Dateiname: invoice.dateiname ?? "",
      Rechnungssteller: invoice.rechnungssteller ?? "",
      Datum: invoice.datum ?? "",
      Rechnungsnummer: invoice.rechnungsnummer ?? "",
      Positionsnummer: position.positionsnummer ?? "",
      Beschreibung: position.beschreibung,
      Menge: position.menge ?? "",
      Einheit: position.einheit ?? "",
      Einzelpreis: position.einzelpreis ?? "",
      "MwSt %": position.steuersatz ?? "",
      Netto: position.nettobetrag ?? "",
      Brutto: position.bruttobetrag ?? "",
      Währung: invoice.waehrung ?? "EUR",
    }))
  );

  if (rows.length === 0) return 0;

  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 34 },
    { wch: 28 },
    { wch: 12 },
    { wch: 20 },
    { wch: 16 },
    { wch: 48 },
    { wch: 10 },
    { wch: 12 },
    { wch: 14 },
    { wch: 10 },
    { wch: 14 },
    { wch: 14 },
    { wch: 10 },
  ];
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Rechnungspositionen");
  XLSX.writeFile(
    wb,
    `rechnungspositionen_${new Date().toISOString().split("T")[0]}.xlsx`
  );
  return rows.length;
}
