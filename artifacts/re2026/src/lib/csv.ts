import { HERKUNFT_EXPORT, STATUS_EXPORT } from "./invoice-origin-export";
import type { Invoice } from "@workspace/api-client-react";
import { TAX_EXPORT_HEADERS, invoiceTaxExportValues } from "./invoice-tax-export";
import { POSITION_EXPORT_HEADERS, createPositionExportRows } from "./position-export";
import { articleCsvCell, articleExportFilename, type ArticleExportTable, type ArticleView } from "./article-summary-export";

export function exportArticleSummaryToCSV(table: ArticleExportTable, view: ArticleView): void {
  if (!table.rows.length) return;
  downloadCSV(table.headers, table.rows.map(row => row.map(articleCsvCell)), `${articleExportFilename(view)}.csv`);
}

function downloadCSV(headers: string[], rows: unknown[][], filename: string) {
  const csvContent = [
    headers.join(";"),
    ...rows.map(row => row.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(";"))
  ].join("\n");

  const blob = new Blob([`\uFEFF${csvContent}`], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function createInvoiceCSVTable(invoices: Invoice[]) {
  const headers = [
    "Dateiname",
    "Rechnungssteller",
    "Datum",
    "Rechnungsnummer",
    "Brutto",
    "Steuersatz",
    "Steuer",
    "Netto",
    "Währung",
    "Bemerkung",
    "Herkunft",
    "Bearbeitungsstatus",
    "Buchungstext",
    "Buchungskonto 1",
    "Betrag Konto 1",
    "Buchungskonto 2",
    "Betrag Konto 2",
    ...TAX_EXPORT_HEADERS,
  ];

  const rows = invoices.map(inv => [
    inv.dateiname || "",
    inv.rechnungssteller || "",
    inv.datum || "",
    inv.rechnungsnummer || "",
    inv.bruttoBetrag ?? "",
    inv.steuersatz ?? "",
    inv.steuerBetrag ?? "",
    inv.nettoBetrag ?? "",
    inv.waehrung || "EUR",
    inv.bemerkung || "",
    HERKUNFT_EXPORT[inv.herkunft ?? "pdf"],
    STATUS_EXPORT[inv.bearbeitungsstatus ?? "unreviewed"],
    inv.buchungstext || "",
    inv.buchungskonto1 || "",
    inv.buchungskonto1Betrag ?? "",
    inv.buchungskonto2 || "",
    inv.buchungskonto2Betrag ?? "",
    ...invoiceTaxExportValues(inv),
  ].map(articleCsvCell));
  return { headers, rows };
}
export function exportInvoicesToCSV(invoices: Invoice[]) {
  const { headers, rows } = createInvoiceCSVTable(invoices);
  downloadCSV(
    headers,
    rows,
    `rechnungen_export_${new Date().toISOString().split("T")[0]}.csv`
  );
}

export function exportInvoicePositionsToCSV(invoices: Invoice[]): number {
  const rows = createPositionExportRows(invoices);

  if (rows.length === 0) return 0;

  downloadCSV(
    [...POSITION_EXPORT_HEADERS],
    // Keep numeric cells numeric (including credits); protect only text.
    rows.map(row => row.map(cell => typeof cell === "string" ? articleCsvCell(cell) : cell)),
    `rechnungspositionen_${new Date().toISOString().split("T")[0]}.csv`
  );
  return rows.length;
}
