import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Invoice } from "@workspace/api-client-react";
import { ArticleSummaryDialog } from "../src/components/ArticleSummaryDialog";

// Exercise the real dialog, controls and summary together. Downloads have their
// own integration suite; this suite deliberately never creates a file.
const invoice = (
  id: number, supplier: string, datum: string | null, articles: string[],
): Invoice => ({
  id, datum, rechnungssteller: supplier, rechnungsnummer: `R-${id}`,
  createdAt: "2026-01-01T00:00:00Z", waehrung: "EUR",
  positionen: articles.map(beschreibung => ({
    beschreibung, menge: 1, einheit: "kg", einzelpreis: 10,
    nettobetrag: 10, bruttobetrag: 11.9, steuersatz: 19,
  })),
});
const invoices = [
  invoice(1, "Alpha", "2026-01-01", ["Kaffee", "Tee"]),
  invoice(2, "Alpha", "2026-01-31", ["Kaffee"]),
  invoice(3, "Beta", "2026-01-15", ["Kaffee", "Kakao"]),
  invoice(4, "Alpha", "2025-12-31", ["Kaffee"]),
  invoice(5, "Beta", null, ["Kaffee"]),
];
const views = ["grouped", "rows"] as const;
type View = typeof views[number];

afterEach(cleanup);

function mount(selectedIds: number[] = [4, 5]) {
  render(<ArticleSummaryDialog open onOpenChange={() => {}}
    invoices={invoices} selectedIds={selectedIds} supplierNames={new Map()} />);
}
function dates(from: string, to: string) {
  fireEvent.change(screen.getByLabelText("Von (Rechnungsdatum)"), { target: { value: from } });
  fireEvent.change(screen.getByLabelText("Bis (einschließlich)"), { target: { value: to } });
}
function counts(invoices: number, positions: number, groups: number) {
  expect(screen.getByTestId("text-article-counts").textContent?.replace(/\s+/g, " ").trim())
    .toBe(`${invoices} Rechnung${invoices === 1 ? "" : "en"} mit Treffern · ${positions} Positionen · ${groups} Gruppen`);
}
function exportsDisabled(disabled: boolean) {
  for (const name of ["CSV herunterladen", "Excel herunterladen"]) {
    expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(disabled);
  }
}
function rows(view: View, count: number, article?: string, supplier?: string) {
  const prefix = view === "grouped" ? "group" : "position";
  const rendered = screen.queryAllByTestId(new RegExp(`^row-article-${prefix}-`));
  expect(rendered).toHaveLength(count);
  expect(screen.queryAllByTestId(new RegExp(`^row-article-${view === "grouped" ? "position" : "group"}-`))).toHaveLength(0);
  for (const row of rendered) {
    if (article) expect(within(row).getAllByRole("cell")[0].textContent).toContain(article);
    if (supplier) expect(within(row).getAllByRole("cell")[1].textContent).toBe(supplier);
  }
  expect(screen.getByTestId(`tab-article-${view}`).getAttribute("aria-selected")).toBe("true");
}
function filtersCleared() {
  expect((screen.getByLabelText("Artikelbeschreibung suchen") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("Lieferant") as HTMLSelectElement).value).toBe("");
  expect((screen.getByRole("button", { name: "Alle Filter zurücksetzen" }) as HTMLButtonElement).disabled).toBe(true);
}

describe("article filter control wiring", () => {
  for (const initialView of views) {
    it(`${initialView}: combines filters, preserves them across scopes/views, and resets hidden dates`, async () => {
      const user = userEvent.setup();
      mount();
      expect(screen.getByRole("radio", { name: "Markierte Rechnungen (2)" }).getAttribute("aria-checked")).toBe("true");
      await user.click(screen.getByRole("radio", { name: "Zeitraum" }));
      dates("2026-01-01", "2026-01-31");
      await user.click(screen.getByTestId(`tab-article-${initialView}`));
      counts(3, 5, 4);
      await user.type(screen.getByLabelText("Artikelbeschreibung suchen"), "kaffee");
      counts(3, 3, 2);
      await user.selectOptions(screen.getByLabelText("Lieferant"), screen.getByRole("option", { name: "Alpha" }));
      counts(2, 2, 1);
      rows(initialView, initialView === "grouped" ? 1 : 2, "Kaffee", "Alpha");
      exportsDisabled(false);

      const otherView = initialView === "grouped" ? "rows" : "grouped";
      await user.click(screen.getByTestId(`tab-article-${otherView}`));
      counts(2, 2, 1);
      rows(otherView, otherView === "grouped" ? 1 : 2, "Kaffee", "Alpha");
      await user.click(screen.getByRole("radio", { name: "Markierte Rechnungen (2)" }));
      expect(screen.queryByLabelText("Von (Rechnungsdatum)")).toBeNull();
      counts(1, 1, 1); // Selected December invoice ignores the January dates.
      rows(otherView, 1, "Kaffee", "Alpha");
      await user.click(screen.getByRole("radio", { name: "Zeitraum" }));
      expect((screen.getByLabelText("Von (Rechnungsdatum)") as HTMLInputElement).value).toBe("2026-01-01");
      expect((screen.getByLabelText("Bis (einschließlich)") as HTMLInputElement).value).toBe("2026-01-31");
      counts(2, 2, 1);
      await user.click(screen.getByRole("radio", { name: "Markierte Rechnungen (2)" }));
      await user.click(screen.getByRole("button", { name: "Alle Filter zurücksetzen" }));
      filtersCleared();
      expect(screen.getByRole("radio", { name: "Markierte Rechnungen (2)" }).getAttribute("aria-checked")).toBe("true");
      counts(2, 2, 2); // Includes the undated Beta selection after reset.
      rows(otherView, 2);
      exportsDisabled(false);
      await user.click(screen.getByRole("radio", { name: "Zeitraum" }));
      for (const label of ["Von (Rechnungsdatum)", "Bis (einschließlich)"]) {
        expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe("");
      }
      counts(5, 7, 4);
      rows(otherView, otherView === "grouped" ? 4 : 7);
    });

    it(`${initialView}: empty combined filters disable exports and reset restores the current scope`, async () => {
      const user = userEvent.setup();
      mount([]);
      await user.click(screen.getByTestId(`tab-article-${initialView}`));
      dates("2026-01-01", "2026-01-31");
      await user.type(screen.getByLabelText("Artikelbeschreibung suchen"), "Tee");
      counts(1, 1, 1);
      await user.selectOptions(screen.getByLabelText("Lieferant"), screen.getByRole("option", { name: "Beta" }));
      counts(0, 0, 0); // Both filters independently match, but their intersection does not.
      for (const view of [initialView, initialView === "grouped" ? "rows" : "grouped"] as const) {
        await user.click(screen.getByTestId(`tab-article-${view}`));
        expect(screen.getByTestId("empty-article").textContent).toContain("Keine Positionen passen zu Suche und Lieferant");
        counts(0, 0, 0);
        rows(view, 0);
        exportsDisabled(true);
        expect(screen.queryByRole("table")).toBeNull();
      }
      await user.click(screen.getByRole("button", { name: "Alle Filter zurücksetzen" }));
      filtersCleared();
      expect(screen.getByRole("radio", { name: "Zeitraum" }).getAttribute("aria-checked")).toBe("true");
      expect(screen.queryByTestId("empty-article")).toBeNull();
      counts(5, 7, 4);
      exportsDisabled(false);

      // Date-only reset must leave the article and supplier filters in place.
      await user.type(screen.getByLabelText("Artikelbeschreibung suchen"), "Kaffee");
      await user.selectOptions(screen.getByLabelText("Lieferant"), screen.getByRole("option", { name: "Alpha" }));
      dates("2026-01-01", "2026-01-31");
      counts(2, 2, 1);
      await user.click(screen.getByRole("button", { name: "Zeitraum zurücksetzen" }));
      counts(3, 3, 1);
      expect((screen.getByLabelText("Artikelbeschreibung suchen") as HTMLInputElement).value).toBe("Kaffee");
      expect((screen.getByLabelText("Lieferant") as HTMLSelectElement).selectedOptions[0].text).toBe("Alpha");
      expect(screen.queryByRole("button", { name: "Zeitraum zurücksetzen" })).toBeNull();
    });
  }
});
