// Import the lib directly to avoid pdf-parse's module-level debug test that
// tries to open ./test/data/05-versions-space.pdf relative to cwd.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
  dataBuffer: Buffer,
  options?: Record<string, unknown>
) => Promise<{ text: string; numpages: number }>;
import OpenAI from "openai";
import { logger } from "./logger";

export interface ExtractedInvoice {
  rechnungssteller: string | null;
  datum: string | null;
  rechnungsnummer: string | null;
  bruttoBetrag: number | null;
  steuersatz: number | null;
  steuerBetrag: number | null;
  nettoBetrag: number | null;
  waehrung: string | null;
  bemerkung: string | null;
}

async function extractWithAI(text: string): Promise<ExtractedInvoice> {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const prompt = `Du bist ein Experte für die Analyse von Rechnungen. Extrahiere aus folgendem Rechnungstext die strukturierten Daten.

Rechnungstext:
${text.substring(0, 4000)}

Antworte NUR mit einem JSON-Objekt (kein Markdown, kein Text drumherum) mit diesen Feldern:
- rechnungssteller: Name des Rechnungsstellers/Lieferanten (string oder null)
- datum: Rechnungsdatum im Format YYYY-MM-DD (string oder null)
- rechnungsnummer: Rechnungsnummer (string oder null)
- bruttoBetrag: Bruttobetrag als Zahl (number oder null)
- steuersatz: Steuersatz in Prozent z.B. 20 für 20% (number oder null)
- steuerBetrag: Steuerbetrag als Zahl (number oder null)
- nettoBetrag: Nettobetrag als Zahl (number oder null)
- waehrung: Währung z.B. "EUR" (string oder null)
- bemerkung: Weitere relevante Hinweise (string oder null)

Verwende null wenn ein Wert nicht gefunden werden kann. Zahlen ohne Tausendertrennzeichen, Dezimaltrennzeichen ist Punkt.`;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 512,
    temperature: 0,
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  const cleaned = content.replace(/```json\n?|\n?```/g, "").trim();
  return JSON.parse(cleaned) as ExtractedInvoice;
}

function extractWithRegex(text: string): ExtractedInvoice {
  const result: ExtractedInvoice = {
    rechnungssteller: null,
    datum: null,
    rechnungsnummer: null,
    bruttoBetrag: null,
    steuersatz: null,
    steuerBetrag: null,
    nettoBetrag: null,
    waehrung: "EUR",
    bemerkung: null,
  };

  // Date patterns: DD.MM.YYYY, YYYY-MM-DD
  const dateMatch = text.match(
    /(\d{2}[.\/-]\d{2}[.\/-]\d{4}|\d{4}-\d{2}-\d{2})/
  );
  if (dateMatch) {
    const raw = dateMatch[1];
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      result.datum = raw;
    } else {
      const parts = raw.split(/[.\/-]/);
      result.datum = `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
    }
  }

  // Invoice number
  const numMatch = text.match(
    /(?:Rechnungs(?:nummer|nr\.?|number)|Invoice\s*(?:No|Nr)\.?|RE[-\s]?Nr\.?)[:\s#]*([A-Z0-9][-A-Z0-9\/_.]{2,20})/i
  );
  if (numMatch) result.rechnungsnummer = numMatch[1].trim();

  // Gross amount
  const bruttoMatch = text.match(
    /(?:Gesamt(?:betrag)?|Brutto(?:betrag)?|Total|Rechnungsbetrag)[:\s]*([€$]?\s*[\d.,]+)/i
  );
  if (bruttoMatch) {
    const num = bruttoMatch[1].replace(/[€$\s]/g, "").replace(",", ".");
    result.bruttoBetrag = parseFloat(num) || null;
  }

  // Tax rate — only accept values that look like real VAT rates (1–50%)
  // Pattern 1: "19% MwSt" / "19,0% MwSt"
  const taxRateMatch1 = text.match(/(\d{1,2}[,.]\d*|\d{1,2})\s*%\s*(?:MwSt|USt|Steuer|VAT)/i);
  // Pattern 2: "MwSt 19%" / "MwSt: 19,0%"
  const taxRateMatch2 = text.match(/(?:MwSt|USt|Steuer|VAT)[.:\s]*(\d{1,2}[,.]\d*|\d{1,2})\s*%/i);
  const taxRateRaw = taxRateMatch1?.[1] ?? taxRateMatch2?.[1] ?? null;
  if (taxRateRaw !== null) {
    const parsed = parseFloat(taxRateRaw.replace(",", "."));
    if (!isNaN(parsed) && parsed > 0 && parsed <= 50) {
      result.steuersatz = parsed;
    }
  }

  // Tax amount
  const taxMatch = text.match(
    /(?:MwSt|USt|Steuer(?:betrag)?|VAT)[:\s]*([€$]?\s*[\d.,]+)/i
  );
  if (taxMatch) {
    const num = taxMatch[1].replace(/[€$\s]/g, "").replace(",", ".");
    result.steuerBetrag = parseFloat(num) || null;
  }

  // Net amount
  const nettoMatch = text.match(
    /(?:Netto(?:betrag)?|Betrag\s+(?:exkl\.|ohne)\s+(?:MwSt|USt)|Subtotal)[:\s]*([€$]?\s*[\d.,]+)/i
  );
  if (nettoMatch) {
    const num = nettoMatch[1].replace(/[€$\s]/g, "").replace(",", ".");
    result.nettoBetrag = parseFloat(num) || null;
  }

  // Currency
  if (text.includes("€") || /EUR/i.test(text)) result.waehrung = "EUR";
  else if (text.includes("$") || /USD/i.test(text)) result.waehrung = "USD";
  else if (/CHF/i.test(text)) result.waehrung = "CHF";

  // Compute missing values
  if (result.bruttoBetrag && result.steuerBetrag && !result.nettoBetrag) {
    result.nettoBetrag = parseFloat(
      (result.bruttoBetrag - result.steuerBetrag).toFixed(2)
    );
  }
  if (result.nettoBetrag && result.steuerBetrag && !result.bruttoBetrag) {
    result.bruttoBetrag = parseFloat(
      (result.nettoBetrag + result.steuerBetrag).toFixed(2)
    );
  }
  if (result.nettoBetrag && result.steuersatz && !result.steuerBetrag) {
    result.steuerBetrag = parseFloat(
      ((result.nettoBetrag * result.steuersatz) / 100).toFixed(2)
    );
  }

  return result;
}

export async function extractInvoiceFromPDF(
  buffer: Buffer,
  filename: string
): Promise<ExtractedInvoice> {
  let text = "";
  try {
    const parsed = await pdfParse(buffer);
    text = parsed.text;
  } catch (err) {
    logger.warn({ err, filename }, "pdf-parse failed, using empty text");
  }

  if (!text.trim()) {
    return {
      rechnungssteller: null,
      datum: null,
      rechnungsnummer: null,
      bruttoBetrag: null,
      steuersatz: null,
      steuerBetrag: null,
      nettoBetrag: null,
      waehrung: "EUR",
      bemerkung: `Kein Text extrahierbar aus ${filename}`,
    };
  }

  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (hasOpenAI) {
    try {
      logger.info({ filename }, "Extracting invoice with OpenAI");
      return await extractWithAI(text);
    } catch (err) {
      logger.warn(
        { err, filename },
        "OpenAI extraction failed, falling back to regex"
      );
    }
  } else {
    logger.info({ filename }, "No OPENAI_API_KEY, using regex extraction");
  }

  return extractWithRegex(text);
}
