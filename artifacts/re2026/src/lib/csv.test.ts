import test from "node:test";
import assert from "node:assert/strict";
import type { Invoice } from "@workspace/api-client-react";
import { exportInvoicesToCSV, exportInvoicePositionsToCSV, exportArticleSummaryToCSV } from "./csv";

const invoice = (value: string): Invoice => ({
  id: 1, createdAt: "2026-01-01T00:00:00Z",
  dateiname: value, rechnungssteller: value, datum: value,
  rechnungsnummer: value, waehrung: value, bemerkung: value,
  bruttoBetrag: -119.5, nettoBetrag: -100, steuerBetrag: -19.5, steuersatz: 0,
  positionen: [{
    positionsnummer: value, beschreibung: value, einheit: value,
    menge: -2, einzelpreis: -50.25, steuersatz: 0, nettobetrag: -100.5, bruttobetrag: -119.595,
  }],
});

// Inspect the actual download payload, not just the cell formatter.
async function download(run: () => unknown) {
  let blob: Blob | undefined;
  let filename = "";
  let clicked = false;
  const link = {
    style: {},
    setAttribute(name: string, value: string) { if (name === "download") filename = value; },
    click() { clicked = true; },
  };
  const context = test.mock;
  context.method(URL, "createObjectURL", (value: Blob) => { blob = value; return "blob:test"; });
  context.method(URL, "revokeObjectURL", () => {});
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement: () => link,
    body: { appendChild() {}, removeChild() {} },
  } });
  try {
    const result = run();
    if (!blob) return { result, content: "", filename, clicked, type: "" };
    // Blob.text strips the BOM; retain it to assert Excel UTF-8 compatibility.
    const content = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await blob.arrayBuffer());
    return { result, content, filename, clicked, type: blob.type };
  } finally {
    context.restoreAll();
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  }
}

const quoted = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

for (const value of [
  "=SUM(A1)", "+12", "-12", "@SUM(A1)", "  =1", "\tformula", "\rformula", "\nformula",
  'Müller; "Söhne"\r\nZürich', "", "'=already text", "normal@example.de",
]) {
  test(`invoice and position CSV safely encode ${JSON.stringify(value)}`, async () => {
    const safe = /^[\s]*[=+\-@]|^[\t\r\n]/.test(value) ? `'${value}` : value;
    const data = invoice(value);
    const invoices = await download(() => exportInvoicesToCSV([data]));
    const positions = await download(() => exportInvoicePositionsToCSV([data]));
    assert.equal(invoices.content.slice(invoices.content.indexOf("\n") + 1),
      [safe, safe, safe, safe, "-119,5", "0", "-19,5", "-100", value ? safe : "EUR", safe].map(quoted).join(";"));
    assert.equal(positions.content.slice(positions.content.indexOf("\n") + 1),
      [safe, safe, safe, safe, safe, safe, -2, safe, -50.25, 0, -100.5, -119.595, safe].map(quoted).join(";"));
    assert.equal(positions.result, 1);
    for (const output of [invoices, positions]) {
      assert.ok(output.content.startsWith("\uFEFFDateiname;Rechnungssteller;"));
      assert.equal(output.type, "text/csv;charset=utf-8;");
      assert.equal(output.clicked, true);
      assert.match(output.filename, /\.csv$/);
    }
  });
}

test("missing invoice amounts stay empty and positionless invoices do not download", async () => {
  const data: Invoice = { id: 1, createdAt: "2026-01-01" };
  const output = await download(() => exportInvoicesToCSV([data]));
  assert.ok(output.content.endsWith('\n"";"";"";"";"";"";"";"";"EUR";""'));
  const empty = await download(() => exportInvoicePositionsToCSV([data]));
  assert.equal(empty.result, 0);
  assert.equal(empty.clicked, false);
});

test("article downloads retain their existing protection without double escaping", async () => {
  const output = await download(() => exportArticleSummaryToCSV({
    headers: ["Artikel", "Netto"], rows: [["=1", -12.5]],
  }, "rows"));
  assert.equal(output.content, '\uFEFFArtikel;Netto\n"\'=1";"-12,5"');
});
