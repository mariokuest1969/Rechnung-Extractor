import { Invoice } from "@workspace/api-client-react";
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

export function exportInvoicesToCSV(invoices: Invoice[]) {
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
    "Bemerkung"
  ];

  const rows = invoices.map(inv => [
    inv.dateiname || "",
    inv.rechnungssteller || "",
    inv.datum || "",
    inv.rechnungsnummer || "",
    inv.bruttoBetrag != null ? inv.bruttoBetrag.toString().replace(".", ",") : "",
    inv.steuersatz != null ? inv.steuersatz.toString().replace(".", ",") : "",
    inv.steuerBetrag != null ? inv.steuerBetrag.toString().replace(".", ",") : "",
    inv.nettoBetrag != null ? inv.nettoBetrag.toString().replace(".", ",") : "",
    inv.waehrung || "EUR",
    inv.bemerkung || ""
  ]);

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
    rows,
    `rechnungspositionen_${new Date().toISOString().split("T")[0]}.csv`
  );
  return rows.length;
}
