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
