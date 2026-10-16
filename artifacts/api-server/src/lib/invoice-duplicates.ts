interface Candidate {
  id: number;
  rechnungssteller?: string | null;
  rechnungsnummer?: string | null;
  datum?: string | null;
  waehrung?: string | null;
  bruttoBetrag?: string | number | null;
}
const normalize = (value?: string | null) => value?.trim().replace(/\s+/g, " ").toLocaleLowerCase("de-DE") ?? "";
export function findInvoiceDuplicates<T extends Candidate>(invoices: readonly T[]) {
  const buckets = new Map<string, T[]>();
  let excludedCount = 0;
  for (const invoice of invoices) {
    const issuer = normalize(invoice.rechnungssteller), number = normalize(invoice.rechnungsnummer);
    const date = invoice.datum?.trim(), currency = normalize(invoice.waehrung);
    const gross = invoice.bruttoBetrag == null || invoice.bruttoBetrag === "" ? NaN : Number(invoice.bruttoBetrag);
    if (!issuer || !number || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !currency || !Number.isFinite(gross)) {
      excludedCount++;
      continue;
    }
    const key = JSON.stringify([issuer, number, date, currency, gross.toFixed(2)]);
    const group = buckets.get(key) ?? [];
    group.push(invoice);
    buckets.set(key, group);
  }
  return {
    groups: [...buckets.entries()].filter(([, rows]) => rows.length > 1)
      .map(([key, rows]) => ({ key, invoices: [...rows].sort((a, b) => a.id - b.id) })),
    excludedCount,
  };
}
export function canDeleteDuplicateCopies<T extends Candidate>(invoices: readonly T[], ids: readonly number[]) {
  const selected = new Set(ids);
  if (!selected.size || selected.size !== ids.length) return false;
  const report = findInvoiceDuplicates(invoices);
  const validIds = new Set<number>();
  for (const group of report.groups) {
    const deleting = group.invoices.filter(invoice => selected.has(invoice.id));
    if (deleting.length === group.invoices.length) return false;
    deleting.forEach(invoice => validIds.add(invoice.id));
  }
  return ids.every(id => validIds.has(id));
}

// Dedicated settings keys act as persistent Dropbox import exclusions, not credentials.
export const duplicateExclusionPrefix = "dropbox_duplicate_excluded:";
