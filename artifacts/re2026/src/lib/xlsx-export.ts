import writeExcelFile, { type SheetData } from "write-excel-file/browser";
import type { Invoice } from "@workspace/api-client-react";
import { createPositionExportObjects } from "./position-export";
import { articleExportFilename, type ArticleExportTable, type ArticleView } from "./article-summary-export";

export function createArticleExcelSheet(table: ArticleExportTable, view: ArticleView) {
  const rows = table.rows.map(row => Object.fromEntries(table.headers.map((header, i) => [header, row[i]])));
  return {
    data: createSheetData(rows, table.headers),
    options: {
      sheet: view === "grouped" ? "Gleiche Artikel" : "Einzelpositionen",
      stickyRowsCount: 1,
      columns: table.headers.map(header => ({
        width: header === "Artikel" ? 48 : header === "Lieferant" || header.endsWith("Status") ? 30 : 18,
      })),
    },
  };
}

export async function exportArticleSummaryToXLSX(table: ArticleExportTable, view: ArticleView): Promise<void> {
  if (!table.rows.length) return;
  const { data, options } = createArticleExcelSheet(table, view);
  await writeExcelFile(data, options).toFile(`${articleExportFilename(view)}.xlsx`);
}

function createSheetData(rows: Record<string, unknown>[], headers: string[]): SheetData {
  return [
    headers.map((value) => ({ value, type: String })),
    ...rows.map((row) => headers.map((header) => {
      const value = row[header] ?? "";
      // Explicit string types prevent user-entered "=" values becoming formulas.
      return typeof value === "number"
        ? { value, type: Number }
        : { value: String(value), type: String };
    })),
  ];
}

export function createInvoiceExcelSheet(invoices: Invoice[]) {
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

  // Fixed headers also produce a useful workbook when there are no invoices.
  const headers = [
    "Dateiname", "Rechnungssteller", "Datum", "Rechnungsnummer", "Brutto (€)",
    "MwSt %", "Steuer (€)", "Netto (€)", "Währung", "Buchungstext",
    "Bemerkung", "Feld 1", "Feld 2", "Feld 3",
  ];
  return {
    data: createSheetData(rows, headers),
    options: {
      sheet: "Rechnungen",
      stickyRowsCount: 1,
      columns: [36, 28, 12, 20, 14, 8, 14, 14, 8, 24, 24, 16, 16, 16]
        .map((width) => ({ width })),
    },
  };
}

export async function exportInvoicesToXLSX(invoices: Invoice[]): Promise<void> {
  const { data, options } = createInvoiceExcelSheet(invoices);
  await writeExcelFile(data, options).toFile(
    `rechnungen_export_${new Date().toISOString().split("T")[0]}.xlsx`
  );
}

export function createPositionExcelSheet(invoices: Invoice[]) {
  const rows = createPositionExportObjects(invoices);
  return {
    count: rows.length,
    data: createSheetData(rows, rows.length ? Object.keys(rows[0]) : []),
    options: {
      sheet: "Rechnungspositionen",
      stickyRowsCount: 1,
      columns: [34, 28, 12, 20, 16, 48, 10, 12, 14, 10, 14, 14, 10]
        .map((width) => ({ width })),
    },
  };
}

export async function exportInvoicePositionsToXLSX(invoices: Invoice[]): Promise<number> {
  const { count, data, options } = createPositionExcelSheet(invoices);
  if (count === 0) return 0;
  await writeExcelFile(data, options).toFile(
    `rechnungspositionen_${new Date().toISOString().split("T")[0]}.xlsx`
  );
  return count;
}
