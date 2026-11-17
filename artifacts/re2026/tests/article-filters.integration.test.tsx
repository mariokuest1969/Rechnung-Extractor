import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
});

async function selectSupplier(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByLabelText("Lieferant"));
  await user.click(screen.getByRole("option", { name }));
}

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
  expect(screen.getByLabelText("Lieferant").textContent).toBe("Alle Lieferanten");
  expect((screen.getByRole("button", { name: "Alle Filter zurücksetzen" }) as HTMLButtonElement).disabled).toBe(true);
}

describe("article filter control wiring", () => {
  it("searches a long list without applying a filter until keyboard selection, and cancels with Escape", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 120 }, (_, i) => invoice(i + 10, `Firma ${String(i).padStart(3, "0")}`, "2026-01-01", ["Tee"]));
    render(<ArticleSummaryDialog open onOpenChange={() => {}}
      invoices={many} selectedIds={[]} supplierNames={new Map()} />);
    await user.click(screen.getByLabelText("Lieferant"));
    expect(screen.getAllByRole("option")).toHaveLength(121);
    await user.type(screen.getByRole("combobox", { name: "Lieferanten suchen" }), "FIRMA 119");
    counts(120, 120, 120);
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.keyboard("{ArrowDown}{Enter}");
    counts(1, 1, 1);
    expect(document.activeElement).toBe(screen.getByLabelText("Lieferant"));
    await user.keyboard("{Enter}");
    await user.type(screen.getByRole("combobox", { name: "Lieferanten suchen" }), "nicht vorhanden");
    expect(screen.getByText("Keine Lieferanten gefunden.")).toBeTruthy();
    counts(1, 1, 1);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByLabelText("Lieferant").textContent).toBe("Firma 119");
    await user.click(screen.getByLabelText("Lieferant"));
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("");
    await user.click(screen.getByRole("option", { name: "Alle Lieferanten" }));
    counts(120, 120, 120);
  });

  it("keeps same-named supplier IDs, unassigned issuers and unknown issuers independently selectable", async () => {
    const user = userEvent.setup();
    const data = [
      { ...invoice(1, "Gleich", null, ["Tee"]), lieferantId: 1 },
      { ...invoice(2, "Gleich", null, ["Tee"]), lieferantId: 2 },
      invoice(3, "Gleich", null, ["Tee"]),
      invoice(4, "", null, ["Tee"]),
      invoice(5, "", null, ["Tee"]),
    ];
    render(<ArticleSummaryDialog open onOpenChange={() => {}}
      invoices={data} selectedIds={[]} supplierNames={new Map([[1, "Gleich"], [2, "Gleich"]])} />);
    for (const label of ["Gleich (id:1)", "Gleich (id:2)", "Gleich (name:gleich)",
      "Unbekannter Lieferant (unknown:4)", "Unbekannter Lieferant (unknown:5)"]) {
      await selectSupplier(user, label);
      counts(1, 1, 1);
      expect(screen.getByLabelText("Lieferant").textContent).toBe(label);
    }
  });

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
      await selectSupplier(user, "Alpha");
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
      await selectSupplier(user, "Beta");
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
      await selectSupplier(user, "Alpha");
      dates("2026-01-01", "2026-01-31");
      counts(2, 2, 1);
      await user.click(screen.getByRole("button", { name: "Zeitraum zurücksetzen" }));
      counts(3, 3, 1);
      expect((screen.getByLabelText("Artikelbeschreibung suchen") as HTMLInputElement).value).toBe("Kaffee");
      expect(screen.getByLabelText("Lieferant").textContent).toBe("Alpha");
      expect(screen.queryByRole("button", { name: "Zeitraum zurücksetzen" })).toBeNull();
    });
  }
});
