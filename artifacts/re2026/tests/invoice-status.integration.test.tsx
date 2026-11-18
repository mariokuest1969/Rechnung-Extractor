import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InvoiceDetailDialog } from "../src/components/InvoiceDetailDialog";
import type { Invoice } from "@workspace/api-client-react";

const mocks = vi.hoisted(() => ({ save: vi.fn().mockResolvedValue({}) }));
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

it("keeps every detail field when all list columns are hidden and saves explicit status", async () => {
  localStorage.setItem("re2026.view.hiddenCols", JSON.stringify([
    "bearbeitungsstatus", "dateiname", "rechnungssteller", "lieferant", "datum", "rnr",
    "brutto", "mwst", "steuer", "netto", "waehrung", "buchung", "bemerkung",
    "freifeld1", "freifeld2", "freifeld3",
  ]));
  const invoice = { id: 42, createdAt: "", bearbeitungsstatus: "unreviewed" } as Invoice;
  const client = new QueryClient();
  const view = (data: Invoice) => <QueryClientProvider client={client}>
    <InvoiceDetailDialog open invoice={data} onOpenChange={vi.fn()} />
  </QueryClientProvider>;
  const { rerender } = render(view(invoice));
  for (const label of ["Dateiname", "Rechnungssteller", "Datum", "Rechnungsnummer", "Brutto",
    "MwSt %", "Steuer", "Netto", "Währung", "Buchungskonto 1", "Betrag Konto 1",
    "Buchungskonto 2", "Betrag Konto 2", "Buchungstext", "Bemerkung", "Feld 1", "Feld 2", "Feld 3"]) {
    expect(screen.getByLabelText(label)).toBeTruthy();
  }
  const status = screen.getByRole("combobox", { name: "Bearbeitungsstatus" }) as HTMLSelectElement;
  expect(status.value).toBe("unreviewed");
  fireEvent.change(status, { target: { value: "done" } });
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ id: 42, data: { bearbeitungsstatus: "done" } }));
  rerender(view({ ...invoice, bearbeitungsstatus: "done" }));
  expect(status.value).toBe("done");
  // Reopening/remounting uses fresh persisted props, not an open-time copy.
  cleanup();
  render(view({ ...invoice, bearbeitungsstatus: "to_review" }));
  expect((screen.getByLabelText("Bearbeitungsstatus") as HTMLSelectElement).value).toBe("to_review");
});
