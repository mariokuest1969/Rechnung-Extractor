import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Invoice, InvoicePosition } from "@workspace/api-client-react";
import { ArticleSummaryDialog } from "../src/components/ArticleSummaryDialog";

// Render the real dialog and summary: assertions cover visible cells and warnings,
// not aggregation arithmetic (covered separately by the library tests).
const position = (beschreibung: string, fields: Partial<InvoicePosition> = {}): InvoicePosition => ({
  beschreibung, einheit: "kg", steuersatz: 19,
  menge: 2, einzelpreis: 5, nettobetrag: 10, bruttobetrag: 11.9, ...fields,
});
const invoice = (
  id: number, datum: string | null, positionen: Invoice["positionen"],
  rechnungssteller = "Alpha",
): Invoice => ({
  id, datum, positionen, rechnungssteller, rechnungsnummer: `R-${id}`,
  createdAt: "2026-01-01T00:00:00Z", waehrung: "EUR",
});

afterEach(cleanup);
beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
});

function mount(invoices: Invoice[], selectedIds: number[] = []) {
  render(<ArticleSummaryDialog open onOpenChange={() => {}}
    invoices={invoices} selectedIds={selectedIds} supplierNames={new Map()} />);
}
function dates(from: string, to: string) {
  fireEvent.change(screen.getByLabelText("Von (Rechnungsdatum)"), { target: { value: from } });
  fireEvent.change(screen.getByLabelText("Bis (einschließlich)"), { target: { value: to } });
}
function warning(missing: number, total: number) {
  expect(screen.getByTestId("text-missing-positions").textContent?.replace(/\s+/g, " ").trim())
    .toBe(`${missing} von ${total} Rechnungen im Umfang ${missing === 1 ? "hat" : "haben"} keine erfassten Positionen und ${missing === 1 ? "fehlt" : "fehlen"} daher in der Übersicht.`);
}
function cells(article: string) {
  const row = screen.getByRole("cell", { name: article, exact: true }).closest("tr")!;
  return within(row).getAllByRole("cell");
}
function partial(cell: HTMLElement, value: string, missing: number, total: number) {
  expect(within(cell).getByText(value, { exact: true })).toBeTruthy();
  const label = within(cell).getByText(value === "—" ? "fehlt" : `unvollständig, ${missing}/${total} fehlen`);
  expect(label.getAttribute("title")).toBe(`${missing} von ${total} Positionen ohne Wert`);
}

describe("visible missing article data", () => {
  it("distinguishes partial, wholly missing and genuine zero values in both views", async () => {
    const user = userEvent.setup();
    mount([invoice(1, "2026-01-10", [
      position("Teilweise"),
      position("Teilweise", { menge: null, nettobetrag: null }),
      position("Teilweise", { menge: null, nettobetrag: null, bruttobetrag: null }),
      position("Fehlend", { menge: null, einzelpreis: null, nettobetrag: null, bruttobetrag: null }),
      position("Nullwerte", { menge: 0, einzelpreis: 0, nettobetrag: 0, bruttobetrag: 0 }),
      position("Nullsumme teilweise", { menge: 0, nettobetrag: 0, bruttobetrag: 0 }),
      position("Nullsumme teilweise", { menge: null, nettobetrag: null, bruttobetrag: null }),
    ])]);

    // A grouped article label also includes the position count.
    const grouped = within(screen.getByRole("cell", { name: /^Teilweise\s*3 Positionen$/ }).closest("tr")!).getAllByRole("cell");
    partial(grouped[3], "2", 2, 3);
    partial(grouped[4], "10,00", 2, 3);
    partial(grouped[5], "23,80", 1, 3);
    for (const cell of cells("Fehlend").slice(3, 6)) partial(cell, "—", 1, 1);
    expect(cells("Nullwerte").slice(3, 6).map(cell => cell.textContent)).toEqual(["0", "0,00", "0,00"]);
    const zeroPartial = within(screen.getByRole("cell", { name: /^Nullsumme teilweise\s*2 Positionen$/ }).closest("tr")!).getAllByRole("cell");
    partial(zeroPartial[3], "0", 1, 2);
    partial(zeroPartial[4], "0,00", 1, 2);
    partial(zeroPartial[5], "0,00", 1, 2);
    expect(screen.queryByTestId("text-missing-positions")).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Einzelpositionen" }));
    expect([4, 6, 7, 8].map(index => cells("Fehlend")[index].textContent)).toEqual(["—", "—", "—", "—"]);
    expect([4, 6, 7, 8].map(index => cells("Nullwerte")[index].textContent)).toEqual(["0", "0,00", "0,00", "0,00"]);
    expect(screen.queryByText(/^unvollständig,/)).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Gleiche Artikel" }));
    for (const cell of cells("Fehlend").slice(3, 6)) partial(cell, "—", 1, 1);
  });

  it("counts invoices without positions in the chosen scope, not only matching articles", async () => {
    const user = userEvent.setup();
    mount([
      invoice(1, "2026-01-10", [position("Tee")]),
      invoice(2, "2026-01-01", []),
      invoice(3, "2026-01-31", null, "Beta"),
      invoice(4, "2025-12-31", []),
      invoice(5, null, undefined),
    ], [1, 4]);
    warning(1, 2);
    await user.click(screen.getByRole("radio", { name: "Zeitraum" }));
    warning(4, 5);
    dates("2026-01-01", "2026-01-31");
    warning(2, 3);
    await user.type(screen.getByLabelText("Artikelbeschreibung suchen"), "Kein Treffer");
    expect(screen.getByTestId("empty-article").textContent).toContain("Keine Positionen passen");
    warning(2, 3);
    await user.click(screen.getByLabelText("Lieferant"));
    await user.click(screen.getByRole("option", { name: "Alpha" }));
    warning(1, 2);
    await user.click(screen.getByRole("tab", { name: "Einzelpositionen" }));
    warning(1, 2);
    await user.click(screen.getByRole("radio", { name: "Markierte Rechnungen (2)" }));
    warning(1, 2);
    await user.click(screen.getByRole("button", { name: "Alle Filter zurücksetzen" }));
    warning(1, 2);
    await user.click(screen.getByRole("radio", { name: "Zeitraum" }));
    dates("2026-01-10", "2026-01-10");
    expect(screen.queryByTestId("text-missing-positions")).toBeNull();
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("keeps the warning for an entirely positionless scope but hides it for invalid or empty scopes", async () => {
    const user = userEvent.setup();
    mount([invoice(1, "2026-01-10", []), invoice(2, "2026-01-20", null)]);
    warning(2, 2);
    expect(screen.getByText("Für diese Rechnungen wurden keine Artikelpositionen erfasst.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    for (const name of ["CSV herunterladen", "Excel herunterladen"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    dates("2026-02-01", "2026-01-01");
    expect(screen.getByText("Ungültiger Zeitraum")).toBeTruthy();
    expect(screen.queryByTestId("text-missing-positions")).toBeNull();
    dates("2026-02-01", "2026-02-28");
    expect(screen.getByText("Im gewählten Umfang liegen keine Rechnungen.")).toBeTruthy();
    expect(screen.queryByTestId("text-missing-positions")).toBeNull();
    await user.click(screen.getByRole("radio", { name: "Markierte Rechnungen (0)" }));
    expect(screen.getByText("Keine Rechnungen markiert")).toBeTruthy();
    expect(screen.queryByTestId("text-missing-positions")).toBeNull();
  });
});
