import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { extractInvoiceFromPDF, extractPages } from "./pdf-extractor";

const fixtureUrl = new URL(
  "./__fixtures__/mixed-text-and-image.pdf.base64",
  import.meta.url
);

async function readMixedPdf(): Promise<Buffer> {
  const encoded = await readFile(fixtureUrl, "utf8");
  return Buffer.from(encoded.trim(), "base64");
}

test("combines embedded text and mocked OCR from a mixed PDF", async () => {
  const ocrPageNumbers: number[] = [];
  const result = await extractPages(await readMixedPdf(), "mixed.pdf", {
    isOcrAvailable: () => true,
    recognizeScannedImage: async (image, pageNumber) => {
      assert.ok(image.length > 0);
      ocrPageNumbers.push(pageNumber);
      return `BILDSEITE ${pageNumber} Gesamtbetrag: 119,00 EUR`;
    },
  });

  assert.equal(result.pageCount, 3);
  assert.match(result.text, /\[Seite 1\]\s+TEXTSEITE RE-NR MIX-42/);
  assert.match(
    result.text,
    /\[Seite 2, OCR\]\s+BILDSEITE 2 Gesamtbetrag: 119,00 EUR/
  );
  assert.match(
    result.text,
    /\[Seite 3, OCR\]\s+BILDSEITE 3 Gesamtbetrag: 119,00 EUR/
  );
  assert.deepEqual(ocrPageNumbers, [2, 3]);
});

test("continues with later pages when OCR fails on one page", async () => {
  const result = await extractPages(await readMixedPdf(), "mixed.pdf", {
    isOcrAvailable: () => true,
    recognizeScannedImage: async (image, pageNumber) => {
      assert.ok(image.length > 0);
      if (pageNumber === 2) {
        throw new Error("simulated OCR failure");
      }
      return "FOLGESEITE TROTZ OCR-FEHLER";
    },
  });

  assert.equal(result.pageCount, 3);
  assert.match(result.text, /\[Seite 1\]\s+TEXTSEITE RE-NR MIX-42/);
  assert.doesNotMatch(result.text, /\[Seite 2, OCR\]/);
  assert.match(
    result.text,
    /\[Seite 3, OCR\]\s+FOLGESEITE TROTZ OCR-FEHLER/
  );
});

test("passes text from early and late PDF pages to structured extraction", async () => {
  let structuredPrompt = "";
  const expectedInvoice = {
    rechnungssteller: "Muster GmbH",
    datum: "2026-09-03",
    rechnungsnummer: "MIX-42",
    bruttoBetrag: 119,
    steuersatz: 19,
    steuerBetrag: 19,
    nettoBetrag: 100,
    waehrung: "EUR",
    bemerkung: "Daten aus mehreren Seiten",
    positionen: [],
  };

  const result = await extractInvoiceFromPDF(
    await readMixedPdf(),
    "mixed.pdf",
    {
      isOcrAvailable: () => true,
      recognizeScannedImage: async (_image, pageNumber) =>
        pageNumber === 2
          ? "MITTELSEITE Leistungszeitraum August 2026"
          : "LETZTE SEITE Gesamtbetrag: 119,00 EUR",
      isAiExtractionAvailable: () => true,
      createStructuredCompletion: async (request) => {
        structuredPrompt = request.messages[0]?.content ?? "";
        return JSON.stringify(expectedInvoice);
      },
    }
  );

  assert.match(structuredPrompt, /\[Seite 1\]\s+TEXTSEITE RE-NR MIX-42/);
  assert.match(
    structuredPrompt,
    /\[Seite 3, OCR\]\s+LETZTE SEITE Gesamtbetrag: 119,00 EUR/
  );
  assert.deepEqual(result, expectedInvoice);
});

test("falls back to regex when structured extraction returns invalid JSON", async () => {
  const result = await extractInvoiceFromPDF(
    await readMixedPdf(),
    "mixed.pdf",
    {
      isOcrAvailable: () => true,
      recognizeScannedImage: async (_image, pageNumber) =>
        pageNumber === 2
          ? "Netto: 100,00 EUR MwSt: 19,00"
          : "Gesamtbetrag: 119,00 EUR",
      isAiExtractionAvailable: () => true,
      createStructuredCompletion: async () => "keine gültige JSON-Antwort",
    }
  );

  assert.equal(result.rechnungsnummer, "MIX-42");
  assert.equal(result.bruttoBetrag, 119);
  assert.equal(result.nettoBetrag, 100);
  assert.equal(result.steuerBetrag, 19);
  assert.equal(result.waehrung, "EUR");
});
