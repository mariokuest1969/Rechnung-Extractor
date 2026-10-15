import test from "node:test";
import assert from "node:assert/strict";
import type { Invoice } from "@workspace/api-client-react";
import { createArticleSummary } from "./article-summary";

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
