import test from "node:test";
import assert from "node:assert/strict";
import { findInvoiceDuplicates, canDeleteDuplicateCopies } from "./invoice-duplicates";
import { hashPdf, signPdfFingerprint, verifyPdfFingerprint } from "./pdf-fingerprint";

test("SHA-256 uses original bytes and preview proofs reject tampering", () => {
  assert.equal(hashPdf(Buffer.from("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const bytes = Buffer.from("%PDF-identical");
  const token = signPdfFingerprint(bytes);
  assert.equal(verifyPdfFingerprint(token), hashPdf(bytes));
  assert.equal(verifyPdfFingerprint(token.replace(/^[a-f0-9]/, c => c === "0" ? "1" : "0")), null);
  assert.equal(verifyPdfFingerprint(token.replace(/\.\d{13}\./, ".1000000000000.")), null);
  assert.equal(verifyPdfFingerprint(hashPdf(bytes)), null);
});

test("identical bytes match missing/conflicting metadata, different or absent hashes do not", () => {
  const pdfSha256 = hashPdf(Buffer.from("%PDF-A"));
  const rows = [{ id: 1, pdfSha256 }, { id: 2, pdfSha256, rechnungsnummer: "different" },
    { id: 3, pdfSha256: hashPdf(Buffer.from("%PDF-B")) }, { id: 4 }, { id: 5, pdfSha256: "" }];
  const result = findInvoiceDuplicates(rows);
  assert.equal(result.excludedCount, 2);
  assert.deepEqual(result.groups.map(g => [g.matchType, g.invoices.map(i => i.id)]), [["pdf_hash", [1, 2]]]);
  assert.equal(canDeleteDuplicateCopies(rows, [2]), true);
  assert.equal(canDeleteDuplicateCopies(rows, [1, 2]), false);
  assert.equal(canDeleteDuplicateCopies(rows, [3]), false);
});

test("hash and metadata bridges never allow deleting an unmatched copy", () => {
  const pdfSha256 = hashPdf(Buffer.from("%PDF-A"));
  const rows = [invoice(1, { pdfSha256 }), invoice(2, { pdfSha256, rechnungsnummer: "other" }), invoice(3)];
  assert.deepEqual(findInvoiceDuplicates(rows).groups.map(g => g.invoices.map(i => i.id)), [[1, 2]]);
  assert.equal(canDeleteDuplicateCopies(rows, [1, 2]), false);
  assert.equal(canDeleteDuplicateCopies(rows, [3]), false);
});

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
