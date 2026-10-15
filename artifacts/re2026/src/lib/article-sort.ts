import type { ArticleGroup, ArticleRow } from "./article-summary";

export type ArticleSortKey = "description" | "supplier" | "unit" | "quantity" | "net" | "gross" | "currency" | "taxRate" | "invoiceCount" | "date" | "invoiceNumber" | "unitPrice";
export interface ArticleSort { key: ArticleSortKey; direction: "asc" | "desc" }
const collator = new Intl.Collator("de", { numeric: true, sensitivity: "base" });
function compare(a: string | number | null | undefined, b: string | number | null | undefined, direction: ArticleSort["direction"]) {
  const absent = (v: typeof a) => v == null || v === "" || v === "—" || (typeof v === "number" && !Number.isFinite(v));
  if (absent(a)) return absent(b) ? 0 : 1;
  if (absent(b)) return -1;
  const result = typeof a === "number" && typeof b === "number" ? a - b : collator.compare(String(a), String(b));
  return direction === "asc" ? result : -result;
}
export function sortArticleGroups(groups: readonly ArticleGroup[], sort: ArticleSort): ArticleGroup[] {
  const key = ["date", "invoiceNumber", "unitPrice"].includes(sort.key) ? "description" : sort.key as keyof ArticleGroup;
  return [...groups].sort((a, b) => compare(a[key], b[key], sort.direction));
}
export function sortArticleRows(rows: readonly ArticleRow[], sort: ArticleSort): ArticleRow[] {
  const value = (row: ArticleRow) => {
    switch (sort.key) {
      case "description": return row.position.beschreibung;
      case "supplier": return row.supplier;
      case "unit": return row.position.einheit;
      case "quantity": return row.position.menge;
      case "net": return row.position.nettobetrag;
      case "gross": return row.position.bruttobetrag;
      case "currency": return row.currency;
      case "taxRate": return row.position.steuersatz;
      case "date": return row.date;
      case "invoiceNumber": return row.invoiceNumber;
      case "unitPrice": return row.position.einzelpreis;
      default: return row.position.beschreibung;
    }
  };
  return [...rows].sort((a, b) => compare(value(a), value(b), sort.direction));
}
