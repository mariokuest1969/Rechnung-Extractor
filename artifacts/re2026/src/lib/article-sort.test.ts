import test from "node:test";
import assert from "node:assert/strict";
import { sortArticleRows, sortArticleGroups } from "./article-sort";
import { createArticleSummary, type ArticleRow } from "./article-summary";

const rows: ArticleRow[] = [10, 2, null].map((quantity, i) => ({
  invoiceId: i, invoiceNumber: `R${i}`, date: ["2026-02-01", "2026-01-31", ""][i],
  supplier: "Firma", supplierKey: "Firma", currency: "EUR",
  position: { beschreibung: `Artikel ${i}`, menge: quantity },
}));
test("article sorting is numeric, keeps unknowns last in both directions and never mutates input", () => {
  assert.deepEqual(sortArticleRows(rows, { key: "quantity", direction: "asc" }).map(r => r.position.menge), [2, 10, null]);
  assert.deepEqual(sortArticleRows(rows, { key: "quantity", direction: "desc" }).map(r => r.position.menge), [10, 2, null]);
  assert.equal(rows[0].position.menge, 10);
  assert.deepEqual(sortArticleRows(rows, { key: "date", direction: "asc" }).map(r => r.invoiceId), [1, 0, 2]);
});
test("groups support numeric totals and German natural text order", () => {
  const { groups } = createArticleSummary(rows.map(r => ({
    id: r.invoiceId, createdAt: "", rechnungssteller: r.supplier, positionen: [r.position],
  })), { scope: "period", selectedIds: [], from: "", to: "" });
  assert.deepEqual(sortArticleGroups(groups, { key: "quantity", direction: "asc" }).map(g => g.quantity), [2, 10, null]);
  assert.equal(sortArticleGroups(groups, { key: "description", direction: "desc" })[0].description, "Artikel 2");
});
