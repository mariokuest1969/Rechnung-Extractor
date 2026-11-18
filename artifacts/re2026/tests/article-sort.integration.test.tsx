import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Invoice } from "@workspace/api-client-react";
import { ArticleSummaryDialog } from "../src/components/ArticleSummaryDialog";

// Deliberately different input, alphabetical, amount and date orders.
// Test the real controls and rendered rows, not the comparator or downloads.
const invoices: Invoice[] = [
  { id: 1, datum: "2026-01-20", beschreibung: "Tee", netto: 10 },
  { id: 2, datum: "2026-01-30", beschreibung: "Kaffee", netto: 30 },
  { id: 3, datum: "2026-01-10", beschreibung: "Kakao", netto: 20 },
].map(({ id, datum, beschreibung, netto }) => ({
  id, datum, rechnungssteller: "Lieferant", rechnungsnummer: `R-${id}`,
  createdAt: "2026-01-01T00:00:00Z", waehrung: "EUR",
  positionen: [{
    beschreibung, menge: 1, einheit: "kg", einzelpreis: netto,
    nettobetrag: netto, bruttobetrag: netto * 1.19, steuersatz: 19,
  }],
}));

afterEach(cleanup);

function expectTable(activeColumn: string, direction: "ascending" | "descending", articles: string[]) {
  const table = within(screen.getByRole("table"));
  const activeButton = table.getByRole("button", { name: activeColumn, exact: true });
  for (const header of table.getAllByRole("columnheader")) {
    expect(header.getAttribute("aria-sort")).toBe(
      header.contains(activeButton) ? direction : "none",
    );
  }
  expect(table.getAllByRole("row").slice(1).map(row =>
    within(row).getAllByRole("cell")[0].textContent,
  )).toEqual(articles);
}

it("toggles sort direction and retains independent group and position sorting across view changes", async () => {
  const user = userEvent.setup();
  render(<ArticleSummaryDialog open onOpenChange={() => {}}
    invoices={invoices} selectedIds={[]} supplierNames={new Map()} />);

  expectTable("Artikel", "ascending", ["Kaffee", "Kakao", "Tee"]);
  await user.click(screen.getByRole("button", { name: "Artikel", exact: true }));
  expectTable("Artikel", "descending", ["Tee", "Kakao", "Kaffee"]);
  await user.click(screen.getByRole("button", { name: "Netto", exact: true }));
  expectTable("Netto", "ascending", ["Tee", "Kakao", "Kaffee"]);
  await user.click(screen.getByRole("button", { name: "Netto", exact: true }));
  expectTable("Netto", "descending", ["Kaffee", "Kakao", "Tee"]);

  await user.click(screen.getByRole("tab", { name: "Einzelpositionen" }));
  expectTable("Artikel", "ascending", ["Kaffee", "Kakao", "Tee"]);
  await user.click(screen.getByRole("button", { name: "Datum", exact: true }));
  expectTable("Datum", "ascending", ["Kakao", "Tee", "Kaffee"]);

  await user.click(screen.getByRole("tab", { name: "Gleiche Artikel" }));
  expectTable("Netto", "descending", ["Kaffee", "Kakao", "Tee"]);
  await user.click(screen.getByRole("tab", { name: "Einzelpositionen" }));
  expectTable("Datum", "ascending", ["Kakao", "Tee", "Kaffee"]);
  await user.click(screen.getByRole("button", { name: "Datum", exact: true }));
  expectTable("Datum", "descending", ["Kaffee", "Tee", "Kakao"]);

  await user.click(screen.getByRole("tab", { name: "Gleiche Artikel" }));
  expectTable("Netto", "descending", ["Kaffee", "Kakao", "Tee"]);
  await user.click(screen.getByRole("button", { name: "Netto", exact: true }));
  expectTable("Netto", "ascending", ["Tee", "Kakao", "Kaffee"]);
  await user.click(screen.getByRole("tab", { name: "Einzelpositionen" }));
  expectTable("Datum", "descending", ["Kaffee", "Tee", "Kakao"]);
  await user.click(screen.getByRole("tab", { name: "Gleiche Artikel" }));
  expectTable("Netto", "ascending", ["Tee", "Kakao", "Kaffee"]);
});
