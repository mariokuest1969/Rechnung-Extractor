import { createCanvas } from "@napi-rs/canvas";
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

// Prefer the Replit AI Integrations proxy (no own OpenAI quota needed);
// fall back to a direct OPENAI_API_KEY if the integration is not configured.
const AI_BASE_URL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
const AI_API_KEY = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

function hasAiExtraction(): boolean {
  return !!(AI_BASE_URL && AI_API_KEY) || !!process.env.OPENAI_API_KEY;
}

const MAX_AI_TEXT_LENGTH = 24_000;
const OCR_RENDER_SCALE = 2;

function createOpenAIClient(): OpenAI {
  return AI_BASE_URL && AI_API_KEY
    ? new OpenAI({ baseURL: AI_BASE_URL, apiKey: AI_API_KEY })
    : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function recognizeScannedImage(
  image: Buffer,
  pageNumber: number
): Promise<string> {
  const response = await createOpenAIClient().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Lies den gesamten Text dieser eingescannten Rechnungsseite (${pageNumber}) per OCR aus. Gib ausschließlich den erkannten Text in natürlicher Lesereihenfolge zurück. Erfinde keine Inhalte.`,
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${image.toString("base64")}`,
              detail: "high",
            },
          },
        ],
      },
    ],
    max_tokens: 4096,
    temperature: 0,
  });

  return response.choices[0]?.message?.content?.trim() ?? "";
}

type RecognizeScannedImage = (
  image: Buffer,
  pageNumber: number
) => Promise<string>;

async function extractTextFromScannedPage(
  page: {
    getViewport: (options: { scale: number }) => { width: number; height: number };
    render: (options: Record<string, unknown>) => { promise: Promise<unknown> };
  },
  pageNumber: number,
  recognizeImage: RecognizeScannedImage
): Promise<string> {
  const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
  const canvas = createCanvas(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height)
  );
  const context = canvas.getContext("2d");

  await page.render({
    canvasContext: context,
    viewport,
  }).promise;

  const image = canvas.toBuffer("image/jpeg", 85);
  return recognizeImage(image, pageNumber);
}

interface PageExtractionDependencies {
  isOcrAvailable: () => boolean;
  recognizeScannedImage: RecognizeScannedImage;
}

const defaultPageExtractionDependencies: PageExtractionDependencies = {
  isOcrAvailable: hasAiExtraction,
  recognizeScannedImage,
};

export async function extractPages(
  buffer: Buffer,
  filename: string,
  dependencies: PageExtractionDependencies = defaultPageExtractionDependencies
): Promise<{ text: string; pageCount: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  }).promise;
  const pageCount = document.numPages;
  const pageTexts: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      try {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const embeddedText = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .trim();

        if (embeddedText) {
          pageTexts.push(`[Seite ${pageNumber}]\n${embeddedText}`);
          continue;
        }

        if (!dependencies.isOcrAvailable()) {
          logger.warn(
            { filename, pageNumber },
            "PDF page has no embedded text and OCR is unavailable"
          );
          continue;
        }

        const ocrText = await extractTextFromScannedPage(
          page,
          pageNumber,
          dependencies.recognizeScannedImage
        );
        if (ocrText) {
          pageTexts.push(`[Seite ${pageNumber}, OCR]\n${ocrText}`);
        }
        logger.info(
          { filename, pageNumber, extractedCharacters: ocrText.length },
          "Scanned PDF page processed with OCR"
        );
      } catch (err) {
        logger.warn(
          { err, filename, pageNumber },
          "PDF page extraction failed, continuing with remaining pages"
        );
      }
    }
  } finally {
    await document.destroy();
  }

  return { text: pageTexts.join("\n\n"), pageCount };
}

function prepareTextForAI(text: string): string {
  const normalized = text
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  if (normalized.length <= MAX_AI_TEXT_LENGTH) return normalized;

  const sectionLength = Math.floor(MAX_AI_TEXT_LENGTH / 3);
  const middleStart = Math.max(
    0,
    Math.floor(normalized.length / 2 - sectionLength / 2)
  );

  return [
    normalized.slice(0, sectionLength),
    "\n\n[... mittlerer Dokumentbereich ...]\n\n",
    normalized.slice(middleStart, middleStart + sectionLength),
    "\n\n[... letzter Dokumentbereich ...]\n\n",
    normalized.slice(-sectionLength),
  ].join("");
}

async function extractWithAI(
  text: string,
  pageCount: number
): Promise<ExtractedInvoice> {
  const client = createOpenAIClient();

  const preparedText = prepareTextForAI(text);
  const prompt = `Du bist ein Experte für die Analyse von Rechnungen. Das Dokument hat ${pageCount} Seite${pageCount === 1 ? "" : "n"}. Berücksichtige ausdrücklich den Inhalt ALLER Seiten und extrahiere aus dem gesamten Rechnungstext die strukturierten Daten.

Rechnungstext:
${preparedText}

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
  let pageCount = 0;
  try {
    const parsed = await extractPages(buffer, filename);
    text = parsed.text;
    pageCount = parsed.pageCount;
    logger.info(
      { filename, pageCount, extractedCharacters: text.length },
      "PDF text extracted"
    );
  } catch (err) {
    logger.warn({ err, filename }, "PDF extraction failed, using empty text");
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

  if (hasAiExtraction()) {
    try {
      logger.info({ filename, pageCount }, "Extracting invoice with OpenAI");
      return await extractWithAI(text, pageCount);
    } catch (err) {
      logger.warn(
        { err, filename },
        "OpenAI extraction failed, falling back to regex"
      );
    }
  } else {
    logger.info({ filename }, "No AI credentials, using regex extraction");
  }

  return extractWithRegex(text);
}
