// Do not coerce booleans, null, arrays, or partially numeric strings to IDs.
export function parseInvoiceId(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^[0-9]+$/.test(value))) {
    return null;
  }
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function parseInvoiceIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ids: number[] = [];
  for (const item of value) {
    const id = parseInvoiceId(item);
    if (id === null) return null;
    ids.push(id);
  }
  return [...new Set(ids)];
}
