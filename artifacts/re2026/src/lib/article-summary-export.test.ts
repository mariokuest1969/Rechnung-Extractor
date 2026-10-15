import test from "node:test";
import assert from "node:assert/strict";
import type { Invoice } from "@workspace/api-client-react";
import { createArticleSummary } from "./article-summary";
import { articleCsvCell, createArticleExportTable } from "./article-summary-export";
import { createArticleExcelSheet } from "./xlsx-export";
import { sortArticleGroups, sortArticleRows } from "./article-sort";

const invoice = (id: number, props: Partial<Invoice> = {}): Invoice => ({
  id, createdAt: "2026-01-01T00:00:00Z", datum: "2026-01-15",
  rechnungssteller: "Firma", waehrung: "EUR",
  positionen: [{ beschreibung: "Kaffee", menge: 2, einheit: "kg", nettobetrag: 10, steuersatz: 19 }],
  ...props,
});
const filters = { scope: "period" as const, selectedIds: [], from: "", to: "" };
const objects = (table: ReturnType<typeof createArticleExportTable>) =>
  table.rows.map(row => Object.fromEntries(table.headers.map((h, i) => [h, row[i]])));

test("exports preserve the selected table sort in both views", () => {
  const summary = createArticleSummary([
    invoice(1), invoice(2, { positionen: [{ beschreibung: "Tee", nettobetrag: 25 }] }),
  ], filters);
  const sorted = {
    ...summary,
    groups: sortArticleGroups(summary.groups, { key: "net", direction: "desc" }),
    rows: sortArticleRows(summary.rows, { key: "net", direction: "desc" }),
  };
  for (const view of ["grouped", "rows"] as const) {
    assert.deepEqual(objects(createArticleExportTable(sorted, view)).map(r => r.Artikel), ["Tee", "Kaffee"]);
  }
});

test("both exports preserve filtered view rows and conservative group separation", () => {
  const summary = createArticleSummary([
    invoice(1), invoice(2), invoice(3, { waehrung: "USD" }),
    invoice(4, { rechnungssteller: "Andere" }),
    invoice(5, { positionen: [{ beschreibung: "Kaffee", einheit: "Stück", steuersatz: 19 }] }),
    invoice(6, { positionen: [{ beschreibung: "Kaffee", einheit: "kg", steuersatz: 7 }] }),
    invoice(7, { datum: "2027-01-01" }), invoice(8, { datum: null }),
  ], { ...filters, from: "2026-01-15", to: "2026-01-15" });
  const grouped = objects(createArticleExportTable(summary, "grouped"));
  assert.equal(grouped.length, 5);
  assert.deepEqual(grouped.map(r => r.Artikel), summary.groups.map(g => g.description));
  assert.equal(grouped.find(r => r.Positionen === 2)?.Netto, 20);
  assert.equal(createArticleExportTable(summary, "rows").rows.length, 6);
});

test("missing, partial, zero, and negative totals remain explicit without estimates", () => {
  const summary = createArticleSummary([invoice(1, {
    positionen: [{ beschreibung: "Kaffee" }, { beschreibung: "Kaffee", menge: 0, nettobetrag: -5 }],
  }), invoice(2, { positionen: [] })], filters);
  const [group] = objects(createArticleExportTable(summary, "grouped"));
  assert.equal(group.Menge, 0);
  assert.equal(group.Netto, -5);
  assert.equal(group["Netto Status"], "unvollständig, 1/2 fehlen");
  assert.equal(group.Brutto, "fehlt");
  assert.equal(group["Brutto Status"], "fehlt");
  const rows = objects(createArticleExportTable(summary, "rows"));
  assert.equal(rows[0].Menge, "fehlt");
  assert.equal(rows[1].Menge, 0);
  assert.equal(rows.length, 2);
});

test("selection ignores dates, empty and invalid scopes cannot export rows", () => {
  const data = [invoice(1), invoice(2)];
  const selected = createArticleSummary(data, { ...filters, scope: "selected", selectedIds: [2], from: "2030-01-01", to: "2020-01-01" });
  assert.equal(objects(createArticleExportTable(selected, "rows"))[0].RNR, "#2");
  for (const summary of [
    createArticleSummary(data, { ...filters, scope: "selected" }),
    createArticleSummary(data, { ...filters, from: "2030-01-01", to: "2020-01-01" }),
  ]) {
    for (const view of ["rows", "grouped"] as const) {
      assert.equal(createArticleExportTable(summary, view).rows.length, 0);
    }
  }
});

test("CSV uses decimal commas and neutralizes text formulas without damaging negative amounts", () => {
  assert.equal(articleCsvCell(-12.5), "-12,5");
  for (const value of ["=SUM(A1)", "+12", "-cmd", "@SUM(A1)", "  =1", "\tformula"]) {
    assert.equal(articleCsvCell(value), `'${value}`);
  }
  assert.equal(articleCsvCell('Öl; "fein"'), 'Öl; "fein"');
});

test("Excel keeps amounts numeric and untrusted text explicitly typed as strings", () => {
  const table = createArticleExportTable(createArticleSummary([invoice(1, {
    positionen: [{ beschreibung: "=1+1", nettobetrag: -12.5 }],
  })], filters), "rows");
  const { data, options } = createArticleExcelSheet(table, "rows");
  assert.equal(options.sheet, "Einzelpositionen");
  assert.deepEqual(data[1][0], { value: "=1+1", type: String });
  assert.deepEqual(data[1][7], { value: -12.5, type: Number });
  assert.equal(data.length, table.rows.length + 1);
});
