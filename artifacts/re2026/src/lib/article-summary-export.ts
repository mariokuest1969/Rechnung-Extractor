import type { createArticleSummary } from "./article-summary";
import { formatDate } from "./format";

export type ArticleView = "grouped" | "rows";
type Summary = ReturnType<typeof createArticleSummary>;
export interface ArticleExportTable {
  headers: string[];
  rows: (string | number)[][];
}

const text = (value: string | null | undefined) => value?.trim() ? value : "fehlt";
const number = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : "fehlt";
const status = (missing: number, total: number) =>
  missing === 0 ? "vollständig" : missing === total ? "fehlt" : `unvollständig, ${missing}/${total} fehlen`;

/** Consume the very same filtered result as the dialog; never regroup or fetch. */
export function createArticleExportTable(summary: Summary, view: ArticleView): ArticleExportTable {
  const headers = view === "grouped"
    ? ["Artikel", "Lieferant", "Einheit", "Menge", "Menge Status", "Netto", "Netto Status",
      "Brutto", "Brutto Status", "Währung", "MwSt %", "Rechnungen", "Positionen"]
    : ["Artikel", "Lieferant", "Datum", "RNR", "Menge", "Einheit", "Einzelpreis",
      "Netto", "Brutto", "Währung", "MwSt %"];
  if (summary.invalidRange) return { headers, rows: [] };
  const rows = view === "grouped"
    ? summary.groups.map(g => [
      g.description, g.supplier, g.unit === "—" ? "fehlt" : g.unit,
      number(g.quantity), status(g.missingQuantity, g.positionCount),
      number(g.net), status(g.missingNet, g.positionCount),
      number(g.gross), status(g.missingGross, g.positionCount),
      g.currency, number(g.taxRate), g.invoiceCount, g.positionCount,
    ])
    : summary.rows.map(r => [
      text(r.position.beschreibung), r.supplier, r.date ? formatDate(r.date) : "fehlt",
      r.invoiceNumber, number(r.position.menge), text(r.position.einheit),
      number(r.position.einzelpreis), number(r.position.nettobetrag),
      number(r.position.bruttobetrag), r.currency, number(r.position.steuersatz),
    ]);
  return { headers, rows };
}

export const articleExportFilename = (view: ArticleView) =>
  `artikeluebersicht_${view === "grouped" ? "gruppiert" : "einzelpositionen"}_${new Date().toISOString().slice(0, 10)}`;

export function articleCsvCell(value: string | number): string {
  if (typeof value === "number") return String(value).replace(".", ",");
  // Quoting alone does not stop spreadsheet applications interpreting formulas.
  return /^[\s]*[=+\-@]|^[\t\r\n]/.test(value) ? `'${value}` : value;
}
