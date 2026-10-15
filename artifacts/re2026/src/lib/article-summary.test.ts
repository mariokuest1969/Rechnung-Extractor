import test from "node:test";
import assert from "node:assert/strict";
import type { Invoice } from "@workspace/api-client-react";
import { articleSupplierOptions, createArticleSummary } from "./article-summary";

const invoice = (id: number, props: Partial<Invoice> = {}): Invoice => ({
  id, createdAt: "2026-01-01T00:00:00Z", datum: "2026-01-15", rechnungssteller: "Firma",
  waehrung: "EUR", positionen: [{ beschreibung: "Kaffee", menge: 2, einheit: "kg", nettobetrag: 10, bruttobetrag: 11.9, steuersatz: 19 }],
  ...props,
});
const period = { scope: "period" as const, selectedIds: [], from: "", to: "" };
test("article date filter includes boundaries and excludes undated invoices with a bound", () => {
  const data = [invoice(1, { datum: "2026-01-01" }), invoice(2, { datum: "2026-01-31" }), invoice(3, { datum: null }), invoice(4, { datum: "2026-02-01" })];
  assert.equal(createArticleSummary(data, { ...period, from: "2026-01-01", to: "2026-01-31" }).rows.length, 2);
  assert.equal(createArticleSummary(data, period).rows.length, 4);
  assert.equal(createArticleSummary(data, { ...period, from: "2026-02-01", to: "2026-01-01" }).invalidRange, true);
});
test("selection is exact; empty selection never falls back to all invoices", () => {
  const data = [invoice(1), invoice(2)];
  assert.equal(createArticleSummary(data, { ...period, scope: "selected" }).rows.length, 0);
  assert.equal(createArticleSummary(data, { ...period, scope: "selected", selectedIds: [2], from: "2030-01-01" }).rows[0].invoiceId, 2);
});
test("summary groups case and whitespace variants while preserving incompatible units, currencies and suppliers", () => {
  const data = [invoice(1), invoice(2, { positionen: [{ beschreibung: "  KAFFEE ", menge: 3, einheit: "kg", nettobetrag: 15, bruttobetrag: 17.85, steuersatz: 19 }] }), invoice(3, { waehrung: "USD" }), invoice(4, { rechnungssteller: "Andere Firma" }), invoice(5, { positionen: [{ beschreibung: "Kaffee", einheit: "Stück", menge: 1 }] })];
  const result = createArticleSummary(data, period);
  assert.equal(result.rows.length, 5);
  assert.equal(result.groups.length, 4);
  const combined = result.groups.find(g => g.positionCount === 2)!;
  assert.equal(combined.quantity, 5);
  assert.equal(combined.net, 25);
  assert.equal(combined.invoiceCount, 2);
});
test("missing values stay unknown, missing positions counted, negative credits retained", () => {
  const result = createArticleSummary([invoice(1, { positionen: [] }), invoice(2, { positionen: [{ beschreibung: "Kaffee" }, { beschreibung: "Kaffee", nettobetrag: -5, menge: -1 }] })], period);
  assert.equal(result.missingPositionsCount, 1);
  assert.equal(result.groups[0].net, -5);
  assert.equal(result.groups[0].gross, null);
  assert.equal(result.groups[0].missingNet, 1);
  assert.equal(result.groups[0].missingQuantity, 1);
});

test("description and supplier filters intersect with dates before grouping without mutating invoices", () => {
  const data = [
    invoice(1, { lieferantId: 7, positionen: [{ beschreibung: "  KAFFEE   Bio ", menge: 2 }, { beschreibung: "Tee", menge: 9 }] }),
    invoice(2, { lieferantId: 7, datum: "2026-02-01", positionen: [{ beschreibung: "Kaffee Bio", menge: 3 }] }),
    invoice(3, { lieferantId: 8, positionen: [{ beschreibung: "Kaffee Bio", menge: 4 }] }),
  ];
  const before = structuredClone(data);
  const result = createArticleSummary(data, { ...period, to: "2026-01-31", description: "  kaFFee bio ", supplierKey: "id:7" });
  assert.equal(result.rows.length, 1);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].quantity, 2);
  assert.equal(result.matchingInvoiceCount, 1);
  assert.deepEqual(data, before);
});

test("selection, empty results and clearing filters share the same rows and counts", () => {
  const data = [invoice(1), invoice(2, { positionen: [] }), invoice(3)];
  const filters = { ...period, scope: "selected" as const, selectedIds: [1, 2], description: "KAFF", supplierKey: "name:firma", from: "2030-01-01" };
  const result = createArticleSummary(data, filters);
  assert.equal(result.rows.length, 1);
  assert.equal(result.matchingInvoiceCount, 1);
  assert.equal(result.invoiceCount, 2);
  assert.equal(result.missingPositionsCount, 1);
  const empty = createArticleSummary(data, { ...filters, description: "Tee" });
  assert.deepEqual(empty.rows, []);
  assert.deepEqual(empty.groups, []);
  assert.equal(empty.matchingInvoiceCount, 0);
  assert.equal(createArticleSummary(data, { ...filters, selectedIds: [] }).rows.length, 0);
  assert.deepEqual(
    createArticleSummary(data, { ...period, description: "", supplierKey: "" }),
    createArticleSummary(data, period),
  );
});

test("supplier options use grouping identity, including unassigned and unknown issuers", () => {
  const data = [
    invoice(1, { lieferantId: 7 }), invoice(2, { lieferantId: 8 }),
    invoice(3, { rechnungssteller: " Freie   Firma " }), invoice(4, { rechnungssteller: "freie firma" }),
    invoice(5, { rechnungssteller: null }), invoice(6, { rechnungssteller: " " }),
  ];
  const names = new Map([[7, "Gleicher Name"], [8, "Gleicher Name"]]);
  const options = articleSupplierOptions(data, names);
  assert.equal(options.length, 5);
  assert.equal(new Set(options.map((o) => o.label)).size, 5);
  assert.equal(createArticleSummary(data, { ...period, supplierKey: "name:freie firma" }, names).rows.length, 2);
  assert.equal(createArticleSummary(data, { ...period, supplierKey: "unknown:5" }, names).rows.length, 1);
  assert.equal(createArticleSummary(data, { ...period, supplierKey: "id:7" }, names).rows[0].supplier, "Gleicher Name");
});

test("filtered results retain unit, currency and tax separation and incomplete totals", () => {
  const data = [
    invoice(1), invoice(2, { waehrung: "USD" }),
    invoice(3, { positionen: [{ beschreibung: "Kaffee", einheit: "kg", steuersatz: 7 }] }),
    invoice(4, { positionen: [{ beschreibung: "Kaffee", einheit: "Stück", steuersatz: 19 }] }),
  ];
  const result = createArticleSummary(data, { ...period, description: "kaff", supplierKey: "name:firma" });
  assert.equal(result.groups.length, 4);
  assert.equal(result.groups.reduce((n, g) => n + g.positionCount, 0), result.rows.length);
  assert.equal(result.groups.find((g) => g.taxRate === 7)?.net, null);
  assert.equal(result.groups.find((g) => g.taxRate === 7)?.missingNet, 1);
});
