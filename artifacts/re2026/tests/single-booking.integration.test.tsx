import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BuchungsDialog } from "../src/components/BuchungsDialog";
import type { Invoice } from "@workspace/api-client-react";

const mocks = vi.hoisted(() => ({ save: vi.fn(), bulk: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  useListBuchungskonten: () => ({ data: [] }),
  useCreateBuchungskonto: () => ({ mutate: vi.fn() }),
  useDeleteBuchungskonto: () => ({ mutate: vi.fn() }),
  useBulkUpdateInvoices: () => ({ mutate: mocks.bulk }),
  useUpdateInvoice: ({ mutation }: any) => ({
    mutate: (payload: unknown) => {
      mocks.save(payload);
      mutation.onError({ status: 400, data: { error: JSON.stringify([{ path: ["buchungskonto1Betrag"], code: "too_big" }]) } });
    },
  }),
  getListInvoicesQueryKey: () => ["invoices"],
  getGetInvoiceStatsQueryKey: () => ["stats"],
  getListBuchungskontenQueryKey: () => ["accounts"],
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("validates both booking fields and retains all drafts after HTTP 400 and refetch", () => {
  const invoice = { id: 1, buchungskonto1Betrag: 0 } as Invoice;
  const client = new QueryClient();
  const close = vi.fn();
  const view = (data: Invoice) => <QueryClientProvider client={client}><BuchungsDialog open onOpenChange={close} invoiceIds={[1]} singleInvoice={data} /></QueryClientProvider>;
  const { rerender } = render(view(invoice));
  const amount1 = screen.getByLabelText("Buchungskonto 1 Betrag") as HTMLInputElement;
  const amount2 = screen.getByLabelText("Buchungskonto 2 Betrag") as HTMLInputElement;
  fireEvent.change(amount1, { target: { value: "10000000000" } });
  fireEvent.change(amount2, { target: { value: "1,234" } });
  fireEvent.click(screen.getByText("Buchung speichern"));
  expect(mocks.save).not.toHaveBeenCalled();
  expect(screen.getAllByRole("alert")).toHaveLength(2);
  fireEvent.change(amount1, { target: { value: "-9999999999,99" } });
  fireEvent.change(amount2, { target: { value: "" } });
  fireEvent.change(screen.getByPlaceholderText("Buchungstext / Verwendungszweck"), { target: { value: "Gutschrift" } });
  fireEvent.click(screen.getByText("Buchung speichern"));
  expect(mocks.save).toHaveBeenCalledWith({ id: 1, data: expect.objectContaining({ buchungskonto1Betrag: -9999999999.99, buchungskonto2Betrag: null, buchungstext: "Gutschrift" }) });
  expect(close).not.toHaveBeenCalled();
  rerender(view({ ...invoice, buchungskonto1Betrag: 5 }));
  expect(amount1.value).toBe("-9999999999,99");
  expect((screen.getByPlaceholderText("Buchungstext / Verwendungszweck") as HTMLInputElement).value).toBe("Gutschrift");
  expect(mocks.bulk).not.toHaveBeenCalled();
});
