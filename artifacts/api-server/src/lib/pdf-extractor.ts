import { createCanvas } from "@napi-rs/canvas";
import OpenAI from "openai";
import { logger } from "./logger";

export interface ExtractedInvoice {
  missingPages?: number[];
  rechnungssteller: string | null;
  datum: string | null;
  rechnungsnummer: string | null;
  bruttoBetrag: number | null;
  steuersatz: number | null;
  steuerBetrag: number | null;
  nettoBetrag: number | null;
  waehrung: string | null;
  bemerkung: string | null;
  positionen: InvoicePosition[];
}

export interface InvoicePosition {
  positionsnummer: string | null;
  beschreibung: string;
  menge: number | null;
  einheit: string | null;
  einzelpreis: number | null;
  steuersatz: number | null;
  nettobetrag: number | null;
  bruttobetrag: number | null;
}

function hasAiExtraction(): boolean {
  return !!(
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL &&
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY
  );
}

const MAX_AI_TEXT_LENGTH = 24_000;
const OCR_RENDER_SCALE = 2;

const AI_REQUEST_TIMEOUT_MS = 60_000;
function createOpenAIClient(): OpenAI {
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

  if (!baseURL || !apiKey) {
    throw new Error("Replit AI integration is not configured");
  }

  return new OpenAI({
    baseURL,
    apiKey,
    timeout: AI_REQUEST_TIMEOUT_MS,
    maxRetries: 1,
  });
}

async function recognizeScannedImage(
  image: Buffer,
  pageNumber: number,
  signal?: AbortSignal
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
  }, { signal });

  return response.choices[0]?.message?.content?.trim() ?? "";
}

type RecognizeScannedImage = (
  image: Buffer,
  pageNumber: number,
  signal?: AbortSignal
) => Promise<string>;

async function extractTextFromScannedPage(
  page: {
    getViewport: (options: { scale: number }) => { width: number; height: number };
    render: (options: Record<string, unknown>) => { promise: Promise<unknown> };
  },
  pageNumber: number,
  recognizeImage: RecognizeScannedImage,
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted();
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
  return recognizeImage(image, pageNumber, signal);
}

interface PageExtractionDependencies {
  isOcrAvailable: () => boolean;
  recognizeScannedImage: RecognizeScannedImage;
}

interface ChatCompletionRequest {
  model: string;
  messages: Array<{ role: "user"; content: string }>;
  response_format?: { type: "json_object" };
  max_tokens: number;
  temperature: number;
}

interface InvoiceExtractionDependencies extends PageExtractionDependencies {
  isAiExtractionAvailable: () => boolean;
  createStructuredCompletion: (
    request: ChatCompletionRequest,
    signal?: AbortSignal
  ) => Promise<string>;
}

const defaultPageExtractionDependencies: PageExtractionDependencies = {
  isOcrAvailable: hasAiExtraction,
  recognizeScannedImage,
};

const defaultInvoiceExtractionDependencies: InvoiceExtractionDependencies = {
  ...defaultPageExtractionDependencies,
  isAiExtractionAvailable: hasAiExtraction,
  createStructuredCompletion: async (request, signal) => {
    const response = await createOpenAIClient().chat.completions.create(request, { signal });
    return response.choices[0]?.message?.content ?? "{}";
  },
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
export async function extractPages(
  buffer: Buffer,
  filename: string,
  dependencies: PageExtractionDependencies = defaultPageExtractionDependencies,
  signal?: AbortSignal
): Promise<{ text: string; pageCount: number; missingPages: number[] }> {
  signal?.throwIfAborted();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  }).promise;
  const pageCount = document.numPages;
  const pageTexts: string[] = [];
  const missingPages: number[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      try {
        signal?.throwIfAborted();
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
          missingPages.push(pageNumber);
          logger.warn(
            { filename, pageNumber },
            "PDF page has no embedded text and OCR is unavailable"
          );
          continue;
        }

        const ocrText = await extractTextFromScannedPage(
          page,
          pageNumber,
          dependencies.recognizeScannedImage,
          signal
        );
        if (ocrText.trim()) {
          pageTexts.push(`[Seite ${pageNumber}, OCR]\n${ocrText}`);
        } else {
          missingPages.push(pageNumber);
        }
        logger.info(
          { filename, pageNumber, extractedCharacters: ocrText.length },
          "Scanned PDF page processed with OCR"
        );
      } catch (err) {
        if (signal?.aborted || isAbortError(err)) throw err;
        missingPages.push(pageNumber);
        logger.warn(
          { err, filename, pageNumber },
          "PDF page extraction failed, continuing with remaining pages"
        );
      }
    }
  } finally {
    await document.destroy();
  }

  return { text: pageTexts.join("\n\n"), pageCount, missingPages };
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
  pageCount: number,
  createStructuredCompletion:
    InvoiceExtractionDependencies["createStructuredCompletion"],
  signal?: AbortSignal
): Promise<ExtractedInvoice> {
  signal?.throwIfAborted();
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
- positionen: Array aller einzelnen Rechnungspositionen. Jede Position enthält:
  - positionsnummer (string oder null)
  - beschreibung (string, Pflichtfeld)
  - menge (number oder null)
  - einheit (string oder null)
  - einzelpreis (number oder null)
  - steuersatz (number oder null)
  - nettobetrag (number oder null)
  - bruttobetrag (number oder null)

Verwende null wenn ein Wert nicht gefunden werden kann. Zahlen ohne Tausendertrennzeichen, Dezimaltrennzeichen ist Punkt. Wenn keine Rechnungspositionen erkennbar sind, verwende ein leeres Array.`;

  const content = await createStructuredCompletion({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_tokens: 4096,
    temperature: 0,
  }, signal);

  const cleaned = content.replace(/```json\n?|\n?```/g, "").trim();
  const parsed = JSON.parse(cleaned) as Partial<ExtractedInvoice>;
  return {
    rechnungssteller: parsed.rechnungssteller ?? null,
    datum: parsed.datum ?? null,
    rechnungsnummer: parsed.rechnungsnummer ?? null,
    bruttoBetrag: parsed.bruttoBetrag ?? null,
    steuersatz: parsed.steuersatz ?? null,
    steuerBetrag: parsed.steuerBetrag ?? null,
    nettoBetrag: parsed.nettoBetrag ?? null,
    waehrung: parsed.waehrung ?? null,
    bemerkung: parsed.bemerkung ?? null,
    positionen: Array.isArray(parsed.positionen)
      ? parsed.positionen.filter(
          (position) =>
            position &&
            typeof position.beschreibung === "string" &&
            position.beschreibung.trim().length > 0
        )
      : [],
  };
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
    positionen: [],
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
  filename: string,
  dependencies: InvoiceExtractionDependencies = defaultInvoiceExtractionDependencies,
  signal?: AbortSignal,
  options: { strict?: boolean } = {},
): Promise<ExtractedInvoice> {
  let text = "";
  let pageCount = 0;
  let missingPages: number[] = [];
  try {
    const parsed = await extractPages(buffer, filename, dependencies, signal);
    text = parsed.text;
    pageCount = parsed.pageCount;
    missingPages = parsed.missingPages;
    logger.info(
      { filename, pageCount, extractedCharacters: text.length },
      "PDF text extracted"
    );
  } catch (err) {
    if (signal?.aborted || isAbortError(err)) throw err;
    if (options.strict) throw err;
    logger.warn({ err, filename }, "PDF extraction failed, using empty text");
  }

  if (!text.trim()) {
    if (options.strict) throw new Error("Kein Text aus PDF extrahierbar");
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
      positionen: [],
      missingPages,
    };
  }

  if (dependencies.isAiExtractionAvailable()) {
    try {
      signal?.throwIfAborted();
      logger.info({ filename, pageCount }, "Extracting invoice with Replit AI");
      const extracted = await extractWithAI(
        text,
        pageCount,
        dependencies.createStructuredCompletion,
        signal
      );
      return { ...extracted, missingPages };
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) throw err;
      if (options.strict) throw err;
      logger.warn(
        { err, filename },
        "Replit AI extraction failed, falling back to regex"
      );
    }
  } else {
    if (options.strict) throw new Error("KI-Auslesung nicht verfügbar");
    logger.warn(
      { filename },
      "Replit AI integration unavailable, using regex extraction"
    );
  }

  return { ...extractWithRegex(text), missingPages };
}
