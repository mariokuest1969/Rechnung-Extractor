import test from "node:test";
import assert from "node:assert/strict";
import { findInvoiceDuplicates, canDeleteDuplicateCopies } from "./invoice-duplicates";

const invoice = (id: number, extra = {}) => ({
  id, rechnungssteller: "Firma GmbH", rechnungsnummer: "RE-123",
  datum: "2026-01-03", bruttoBetrag: "119.00", waehrung: "EUR", ...extra,
});
test("duplicate matching requires complete issuer, invoice number, calendar date, currency and gross", () => {
  const rows = [invoice(1), invoice(2, { rechnungssteller: "  FIRMA   GmbH ", bruttoBetrag: 119 }),
    invoice(3, { datum: "2026-01-04" }), invoice(4, { waehrung: "USD" }),
    invoice(5, { rechnungssteller: "Andere Firma" }), invoice(6, { rechnungsnummer: "RE123" }),
    invoice(7, { bruttoBetrag: "120" }), invoice(8, { rechnungsnummer: null }),
    invoice(9, { bruttoBetrag: null })];
  const result = findInvoiceDuplicates(rows);
  assert.deepEqual(result.groups.map(g => g.invoices.map(i => i.id)), [[1, 2]]);
  assert.equal(result.excludedCount, 2);
});
test("duplicate deletion requires a retained copy and rejects unknown, unique, stale and repeated IDs", () => {
  const rows = [invoice(1), invoice(2), invoice(3), invoice(4, { rechnungsnummer: "unique" })];
  assert.equal(canDeleteDuplicateCopies(rows, [2, 3]), true);
  for (const ids of [[], [1, 2, 3], [2, 4], [99], [2, 2]]) {
    assert.equal(canDeleteDuplicateCopies(rows, ids), false);
  }
  assert.equal(canDeleteDuplicateCopies([invoice(1), invoice(2, { bruttoBetrag: "1" })], [2]), false);
});
test("every affected duplicate group keeps an original, including negative credit notes", () => {
  const rows = [invoice(1), invoice(2), invoice(3, { bruttoBetrag: "-119" }), invoice(4, { bruttoBetrag: "-119" })];
  assert.equal(canDeleteDuplicateCopies(rows, [2, 4]), true);
  assert.equal(canDeleteDuplicateCopies(rows, [2, 3, 4]), false);
});
