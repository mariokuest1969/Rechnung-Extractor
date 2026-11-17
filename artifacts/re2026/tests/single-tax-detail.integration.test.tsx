import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InvoiceDetailDialog } from "../src/components/InvoiceDetailDialog";
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
vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("validates detail tax before calculation, retains rejected rates and saves zero as zero", async () => {
  mocks.save.mockRejectedValueOnce({ status: 400 }).mockResolvedValue({});
  const invoice = { id: 1, steuersatz: 19, bruttoBetrag: 119 } as Invoice;
  render(<QueryClientProvider client={new QueryClient()}><InvoiceDetailDialog open invoice={invoice} onOpenChange={vi.fn()} /></QueryClientProvider>);
  const input = screen.getByRole("textbox", { name: "MwSt %" }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "101" } });
  fireEvent.blur(input);
  expect(mocks.save).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("0 und 100");
  fireEvent.change(input, { target: { value: "7,55" } });
  fireEvent.blur(input);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Nicht gespeichert"));
  expect(input.value).toBe("7,55");
  fireEvent.change(input, { target: { value: "0" } });
  fireEvent.blur(input);
  await waitFor(() => expect(mocks.save).toHaveBeenLastCalledWith({ id: 1, data: { steuersatz: 0, nettoBetrag: 119, steuerBetrag: 0 } }));
  expect(screen.queryByRole("alert")).toBeNull();
});
