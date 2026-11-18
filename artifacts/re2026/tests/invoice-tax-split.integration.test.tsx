import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InvoiceDetailDialog } from "../src/components/InvoiceDetailDialog";
import { InvoiceTaxEditor } from "../src/components/InvoiceTaxEditor";
import { createInvoiceCSVTable } from "../src/lib/csv";
import { createInvoiceExcelSheet } from "../src/lib/xlsx-export";
import type { Invoice } from "@workspace/api-client-react";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("react-pdf", () => ({
  Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock("@workspace/api-client-react", () => ({
  useListLieferanten: () => ({ data: [] }),
  useUpdateInvoice: () => ({ mutateAsync: mocks.save }),
  getListInvoicesQueryKey: () => ["invoices"],
  getGetInvoiceStatsQueryKey: () => ["stats"],
}));
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });
const base = { id: 42, createdAt: "", steuerModus: "single", bruttoBetrag: 355, nettoBetrag: 310, steuerBetrag: 45 } as Invoice;
const split = { ...base, steuerModus: "split", netto7: 100, netto19: 200, netto0: 10,
  steuer7: 7, steuer19: 38, steuer0: 0, steuersatz: null } as Invoice;
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } });

it("offers all three net inputs despite hidden list columns and saves one atomic net-only request", async () => {
  localStorage.setItem("re2026.view.hiddenCols", JSON.stringify(["netto7", "netto19", "netto0", "steuer7", "steuer19", "steuer0", "netto", "steuer", "brutto"]));
  mocks.save.mockResolvedValue(split);
  render(<QueryClientProvider client={new QueryClient()}>
    <InvoiceDetailDialog open invoice={base} onOpenChange={vi.fn()} />
  </QueryClientProvider>);
  fireEvent.change(screen.getByRole("combobox", { name: "Steuerberechnung" }), { target: { value: "split" } });
  // No allocation may be guessed from the old mixed totals.
  expect((screen.getByLabelText("Netto 7 %") as HTMLInputElement).value).toBe("");
  expect(screen.queryByRole("textbox", { name: "Brutto" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "MwSt %" })).toBeNull();
  change("Netto 7 %", "100");
  change("Netto 19 %", "200");
  change("Netto 0 %", "10");
  expect(within(screen.getByLabelText("Berechnete Beträge")).getByText("355,00")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Steueraufteilung speichern" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
    id: 42, data: { steuerModus: "split", netto7: 100, netto19: 200, netto0: 10 },
  }));
});

it("validates complete signed amounts and sum bounds without partial writes; keeps rejected drafts", async () => {
  const save = vi.fn().mockRejectedValueOnce({ data: { error: "Speichern fehlgeschlagen" } }).mockResolvedValue({});
  render(<InvoiceTaxEditor invoice={base} onSave={save}>legacy</InvoiceTaxEditor>);
  fireEvent.change(screen.getByLabelText("Steuerberechnung"), { target: { value: "split" } });
  const button = screen.getByRole("button", { name: "Steueraufteilung speichern" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  for (const invalid of ["1,001", "1e-7", "12abc", "Infinity", "10000000000", "9999999999,99"]) {
    change("Netto 7 %", invalid);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(save).not.toHaveBeenCalled();
  }
  change("Netto 7 %", "-0,50");
  change("Netto 19 %", "-0,50");
  change("Netto 0 %", "0");
  expect(screen.getByText("-1,14")).toBeTruthy();
  expect(screen.getByText("-0,14")).toBeTruthy();
  fireEvent.click(button);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Speichern fehlgeschlagen"));
  expect((screen.getByLabelText("Netto 7 %") as HTMLInputElement).value).toBe("-0,50");
  fireEvent.click(button);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save).toHaveBeenLastCalledWith({ steuerModus: "split", netto7: -0.5, netto19: -0.5, netto0: 0 });
});

it("retains zero versus missing values, reopens with fresh data and explicitly removes the split", async () => {
  const save = vi.fn().mockResolvedValue({});
  const view = (invoice: Invoice) => <InvoiceTaxEditor invoice={invoice} onSave={save}>legacy-single-fields</InvoiceTaxEditor>;
  const { rerender } = render(view({ ...split, netto0: null }));
  expect((screen.getByLabelText("Netto 0 %") as HTMLInputElement).value).toBe("");
  rerender(view({ ...split, netto7: -50, netto0: 0 }));
  expect((screen.getByLabelText("Netto 7 %") as HTMLInputElement).value).toBe("-50");
  expect((screen.getByLabelText("Netto 0 %") as HTMLInputElement).value).toBe("0");
  fireEvent.change(screen.getByLabelText("Steuerberechnung"), { target: { value: "single" } });
  expect(screen.queryByText("legacy-single-fields")).toBeNull();
  expect(screen.getByText(/Die bisherigen Summen bleiben erhalten/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Zu Einzelsteuer wechseln" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ steuerModus: "single" }));
  rerender(view({ ...base, bruttoBetrag: -53.5 }));
  expect(screen.getByText("legacy-single-fields")).toBeTruthy();
});

it("includes split fields and totals in both export tables without inventing legacy values", () => {
  const credit = { ...split, id: 43, rechnungssteller: "=FORMULA", netto7: -0.5, netto19: null, netto0: 0,
    steuer7: -0.04, steuer19: null, steuer0: 0, nettoBetrag: -0.5, steuerBetrag: -0.04, bruttoBetrag: -0.54 };
  const csv = createInvoiceCSVTable([base, credit]);
  const excel = createInvoiceExcelSheet([base, credit]);
  const headers = excel.data[0].map(cell => cell?.value);
  for (const key of ["Netto 7 %", "Netto 19 %", "Netto 0 %", "Steuer 7 %", "Steuer 19 %", "Steuer 0 %"]) {
    expect(csv.headers).toContain(key);
    expect(headers).toContain(key);
    expect(csv.rows[0][csv.headers.indexOf(key)]).toBe("");
    expect(excel.data[1][headers.indexOf(key)]?.value).toBe("");
  }
  expect(csv.rows[1][csv.headers.indexOf("Netto 7 %")]).toBe("-0,5");
  expect(csv.rows[1][csv.headers.indexOf("Rechnungssteller")]).toBe("'=FORMULA");
  expect(excel.data[2][headers.indexOf("Netto 7 %")]).toEqual({ type: Number, value: -0.5 });
  expect(excel.data[2][headers.indexOf("Netto 0 %")]?.value).toBe(0);
  expect(excel.data[2][headers.indexOf("Netto 19 %")]?.value).toBe("");
  expect(excel.data[2][headers.indexOf("Rechnungssteller")]).toEqual({ type: String, value: "=FORMULA" });
  // The exact selection passed by the table determines the exported rows.
  expect(createInvoiceCSVTable([credit]).rows).toHaveLength(1);
  expect(createInvoiceExcelSheet([credit]).data).toHaveLength(2);
});
