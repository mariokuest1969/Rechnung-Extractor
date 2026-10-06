export const MAX_BULK_REEXTRACT_INVOICES = 20;

export function createBulkReextractBlock<T extends { id: number }>(
  selectedInvoices: T[]
): { queue: T[]; remainingIds: Set<number> } {
  const queue = selectedInvoices.slice(0, MAX_BULK_REEXTRACT_INVOICES);
  const processedIds = new Set(queue.map((invoice) => invoice.id));
  return {
    queue,
    remainingIds: new Set(
      selectedInvoices
        .filter((invoice) => !processedIds.has(invoice.id))
        .map((invoice) => invoice.id)
    ),
  };
}

export async function processSequentially<T, R>(
  items: T[],
  process: (item: T) => Promise<R>,
  onSettled?: (result: PromiseSettledResult<R>, index: number) => void
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = [];
  for (const [index, item] of items.entries()) {
    let result: PromiseSettledResult<R>;
    try {
      result = { status: "fulfilled", value: await process(item) };
    } catch (reason) {
      result = { status: "rejected", reason };
    }
    results.push(result);
    onSettled?.(result, index);
  }
  return results;
}