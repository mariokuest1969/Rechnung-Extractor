import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import { readSheet } from "read-excel-file/node";
import type { Invoice } from "@workspace/api-client-react";
import { ArticleSummaryDialog } from "../src/components/ArticleSummaryDialog";
import { exportArticleSummaryToCSV } from "../src/lib/csv";
import { exportArticleSummaryToXLSX } from "../src/lib/xlsx-export";

// No exporter, workbook writer, filtering, sorting or dialog mocks. Only the
// browser's final file-save boundary is intercepted; those bytes go to disk.
const description = 'Öl; "fein"\nZürich';
const invoice = (id: number, datum: string | null, net: number): Invoice => ({
  id, datum, createdAt: "2026-01-01T00:00:00Z", rechnungsnummer: `R-${id}`,
  rechnungssteller: "Müller", waehrung: "EUR",
  positionen: [
    { beschreibung: description, menge: 2.5, einheit: "kg", einzelpreis: 5,
      nettobetrag: net, bruttobetrag: net * 1.19, steuersatz: 19 },
    { beschreibung: "=1+1", menge: 0, nettobetrag: 0 },
  ],
});
const invoices = [
  invoice(1, "2026-01-01", 12.5), invoice(2, "2026-01-31", -2.5),
  invoice(3, "2025-12-31", 999), invoice(4, null, -7.5),
];
const views = ["grouped", "rows"] as const;
const formats = ["csv", "xlsx"] as const;
let directory: string;
let saved: { filename: string; path: string; type: string }[];
let writes: Promise<void>[];
let blobs: Map<string, Blob>;
let createURL: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "article-download-"));
  saved = [];
  writes = [];
  blobs = new Map();
  createURL = vi.fn((blob: Blob) => {
    const url = `blob:download-${blobs.size}`;
    blobs.set(url, blob);
    return url;
  });
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = createURL;
    static revokeObjectURL = vi.fn();
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    const blob = blobs.get(this.href);
    if (!blob) throw new Error("Download did not reference a generated Blob");
    const filename = this.download;
    const path = join(directory, filename);
    writes.push(new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    }).then(async bytes => {
      await writeFile(path, Buffer.from(bytes));
      saved.push({ filename, path, type: blob.type });
    }));
  });
});

afterEach(async () => {
  cleanup();
  await Promise.all(writes);
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

function mount(selectedIds: number[] = [4]) {
  return render(<ArticleSummaryDialog open onOpenChange={() => {}}
    invoices={invoices} selectedIds={selectedIds} supplierNames={new Map()} />);
}
function dates(from: string, to: string) {
  fireEvent.change(screen.getByTestId("input-article-from"), { target: { value: from } });
  fireEvent.change(screen.getByTestId("input-article-to"), { target: { value: to } });
}
async function download(format: typeof formats[number]) {
  const start = saved.length;
  await userEvent.click(screen.getByTestId(`button-article-export-${format}`));
  await waitFor(() => expect(saved).toHaveLength(start + 1));
  await waitFor(() => expect(screen.getByTestId(`button-article-export-${format}`).hasAttribute("disabled")).toBe(false));
  return saved[start];
}

describe("article dialog → actual CSV/XLSX download bytes → independent file reader", () => {
  for (const view of views) for (const scope of ["period", "selected"] as const) {
    it(`${view}, ${scope}: both file formats retain filtered content and types`, async () => {
      mount();
      await userEvent.click(screen.getByTestId("button-scope-period"));
      // Boundary dates included, outside/undated excluded. Selection deliberately
      // uses an undated invoice and must ignore even an inverted date range.
      dates(scope === "period" ? "2026-01-01" : "2030-01-01", "2026-01-31");
      if (scope === "selected") await userEvent.click(screen.getByTestId("button-scope-selected"));
      await userEvent.click(screen.getByTestId(`tab-article-${view}`));
      await userEvent.click(screen.getByTitle("Netto aufsteigend sortieren"));
      const expectedNets = scope === "selected" ? [-7.5] : view === "grouped" ? [10] : [-2.5, 12.5];
      for (const format of formats) {
        const date = new Date().toISOString().slice(0, 10);
        const file = await download(format);
        expect(file.filename).toBe(`artikeluebersicht_${view === "grouped" ? "gruppiert" : "einzelpositionen"}_${date}.${format}`);
        const bytes = await readFile(file.path);
        let records: Record<string, unknown>[];
        if (format === "csv") {
          expect(file.type).toBe("text/csv;charset=utf-8;");
          expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
          const text = bytes.toString("utf8");
          expect(text).toContain('"Öl; ""fein""\nZürich"');
          expect(text).toContain('"\'=1+1"');
          records = parse(bytes, { bom: true, delimiter: ";", columns: true });
        } else {
          expect(bytes.subarray(0, 2).toString()).toBe("PK");
          const sheets = await readSheet(file.path, view === "grouped" ? "Gleiche Artikel" : "Einzelpositionen");
          const [headers, ...rows] = sheets;
          records = rows.map(row => Object.fromEntries(headers.map((header, i) => [String(header), row[i]])));
        }
        const oil = records.filter(row => row.Artikel === description);
        expect(oil.map(row => row.Netto)).toEqual(expectedNets.map(n => format === "csv" ? String(n).replace(".", ",") : n));
        expect(oil.every(row => row.Lieferant === "Müller" && row.Währung === "EUR")).toBe(true);
        const formulaRows = records.filter(row => row.Artikel === (format === "csv" ? "'=1+1" : "=1+1"));
        expect(formulaRows).toHaveLength(view === "grouped" || scope === "selected" ? 1 : 2);
        expect(records).toHaveLength(oil.length + formulaRows.length);
        for (const row of formulaRows) {
          expect(row.Netto).toBe(format === "csv" ? "0" : 0);
          expect(row.Brutto).toBe("fehlt");
        }
        for (const row of oil) {
          for (const field of ["Menge", "Netto", "Brutto", "MwSt %", ...(view === "grouped" ? ["Rechnungen", "Positionen"] : ["Einzelpreis"])]) {
            expect(typeof row[field]).toBe(format === "csv" ? "string" : "number");
          }
          if (view === "grouped") {
            const count = scope === "period" ? 2 : 1;
            expect(row.Positionen).toBe(format === "csv" ? String(count) : count);
            expect(row["Netto Status"]).toBe("vollständig");
          } else {
            expect(row.RNR).toBe(scope === "selected" ? "R-4" : row.Netto === (format === "csv" ? "-2,5" : -2.5) ? "R-2" : "R-1");
            expect(row.Datum).toBe(scope === "selected" ? "fehlt" : row.RNR === "R-2" ? "31.01.2026" : "01.01.2026");
          }
        }
      }
    });
  }

  for (const view of views) for (const state of ["empty", "invalid", "unmarked"] as const) {
    it(`${view}: ${state} cannot initiate either download`, async () => {
      mount([]);
      await userEvent.click(screen.getByTestId(`tab-article-${view}`));
      if (state === "unmarked") await userEvent.click(screen.getByTestId("button-scope-selected"));
      else dates("2030-01-01", state === "invalid" ? "2020-01-01" : "2030-01-31");
      for (const format of formats) {
        const button = screen.getByTestId(`button-article-export-${format}`);
        expect(button.hasAttribute("disabled")).toBe(true);
        await userEvent.click(button);
      }
      expect(createURL).not.toHaveBeenCalled();
      expect(writes).toHaveLength(0);
    });
  }

  for (const view of views) for (const format of formats) {
    it(`${view}, ${format}: file-save failure stays visible and retry works`, async () => {
      mount();
      await userEvent.click(screen.getByTestId(`tab-article-${view}`));
      createURL.mockImplementationOnce(() => { throw new Error("File save unavailable"); });
      await userEvent.click(screen.getByTestId(`button-article-export-${format}`));
      expect((await screen.findByRole("alert")).textContent).toBe("Der Export konnte nicht erstellt werden. Bitte erneut versuchen.");
      expect(saved).toHaveLength(0);
      expect(writes).toHaveLength(0);
      for (const f of formats) expect(screen.getByTestId(`button-article-export-${f}`).hasAttribute("disabled")).toBe(false);
      // Error remains across view changes, rather than disappearing immediately.
      await userEvent.click(screen.getByTestId(`tab-article-${view === "rows" ? "grouped" : "rows"}`));
      expect(screen.getByRole("alert").textContent).toContain("Export konnte nicht");
      await download(format);
      expect(screen.queryByRole("alert")).toBeNull();
    });
  }

  it("both exporter helpers also reject empty tables without file creation", async () => {
    for (const view of views) {
      exportArticleSummaryToCSV({ headers: ["Artikel"], rows: [] }, view);
      await exportArticleSummaryToXLSX({ headers: ["Artikel"], rows: [] }, view);
    }
    expect(createURL).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});
