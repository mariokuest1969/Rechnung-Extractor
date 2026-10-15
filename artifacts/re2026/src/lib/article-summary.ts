import type { Invoice, InvoicePosition } from "@workspace/api-client-react";

export type ArticleScope = "period" | "selected";
export interface ArticleFilters {
  scope: ArticleScope;
  selectedIds: readonly number[];
  from: string;
  to: string;
  description?: string;
  supplierKey?: string;
}
export interface ArticleRow {
  invoiceId: number;
  invoiceNumber: string;
  date: string;
  supplier: string;
  supplierKey: string;
  currency: string;
  position: InvoicePosition;
}
export interface ArticleGroup {
  key: string;
  description: string;
  supplier: string;
  unit: string;
  currency: string;
  taxRate: number | null;
  quantity: number | null;
  net: number | null;
  gross: number | null;
  missingQuantity: number;
  missingNet: number;
  missingGross: number;
  positionCount: number;
  invoiceCount: number;
}
const normalized = (text: string) => text.trim().replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
const amount = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) ? value : null;
const sum = (a: number | null, b: number | null) => b === null ? a : (a ?? 0) + b;

function articleSupplier(invoice: Invoice, supplierNames: ReadonlyMap<number, string>) {
  return {
    supplier: (invoice.lieferantId ? supplierNames.get(invoice.lieferantId) : undefined) || invoice.rechnungssteller?.trim() || "Unbekannter Lieferant",
    // Unknown issuers must remain distinct across invoices.
    supplierKey: invoice.lieferantId ? `id:${invoice.lieferantId}` : invoice.rechnungssteller?.trim() ? `name:${normalized(invoice.rechnungssteller)}` : `unknown:${invoice.id}`,
  };
}

export function articleSupplierOptions(invoices: readonly Invoice[], supplierNames: ReadonlyMap<number, string>) {
  const options = new Map<string, string>();
  for (const invoice of invoices) {
    const { supplierKey, supplier } = articleSupplier(invoice, supplierNames);
    options.set(supplierKey, supplier);
  }
  const labels = [...options.values()];
  return [...options].map(([key, label]) => ({
    key,
    label: labels.filter((value) => value === label).length > 1 ? `${label} (${key})` : label,
  })).sort((a, b) => a.label.localeCompare(b.label, "de"));
}

/** Dates are invoice calendar dates, inclusive; unknown dates never match a bounded period. */
export function createArticleSummary(invoices: readonly Invoice[], filters: ArticleFilters, supplierNames: ReadonlyMap<number, string> = new Map()) {
  const invalidRange = Boolean(filters.from && filters.to && filters.from > filters.to);
  const selected = new Set(filters.selectedIds);
  const scoped = invalidRange && filters.scope === "period" ? [] : invoices.filter((invoice) => {
    if (filters.scope === "selected") return selected.has(invoice.id);
    if (!filters.from && !filters.to) return true;
    if (!invoice.datum) return false;
    const date = invoice.datum.slice(0, 10);
    return (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to);
  });
  const supplierScoped = scoped.filter((invoice) =>
    !filters.supplierKey || articleSupplier(invoice, supplierNames).supplierKey === filters.supplierKey);
  const query = normalized(filters.description ?? "");
  const rows: ArticleRow[] = supplierScoped.flatMap((invoice) => {
    const { supplier, supplierKey } = articleSupplier(invoice, supplierNames);
    return (invoice.positionen ?? []).filter((position) => !query || normalized(position.beschreibung).includes(query)).map((position) => ({
      invoiceId: invoice.id, invoiceNumber: invoice.rechnungsnummer || `#${invoice.id}`,
      date: invoice.datum ?? "", supplier, supplierKey,
      currency: invoice.waehrung?.trim().toUpperCase() || "Unbekannt", position,
    }));
  });
  const grouped = new Map<string, ArticleGroup & { invoiceIds: Set<number> }>();
  rows.forEach((row, index) => {
    const p = row.position;
    const key = JSON.stringify([
      normalized(p.beschreibung) || `unknown:${index}`, row.supplierKey,
      normalized(p.einheit ?? ""), row.currency, amount(p.steuersatz),
    ]);
    let group = grouped.get(key);
    if (!group) {
      group = {
        key, description: p.beschreibung.trim() || "Ohne Artikelbeschreibung",
        supplier: row.supplier, unit: p.einheit?.trim() || "—",
        currency: row.currency, taxRate: amount(p.steuersatz), quantity: null, net: null, gross: null,
        missingQuantity: 0, missingNet: 0, missingGross: 0, positionCount: 0,
        invoiceCount: 0, invoiceIds: new Set(),
      };
      grouped.set(key, group);
    }
    const quantity = amount(p.menge), net = amount(p.nettobetrag), gross = amount(p.bruttobetrag);
    group.quantity = sum(group.quantity, quantity);
    group.net = sum(group.net, net);
    group.gross = sum(group.gross, gross);
    group.missingQuantity += quantity === null ? 1 : 0;
    group.missingNet += net === null ? 1 : 0;
    group.missingGross += gross === null ? 1 : 0;
    group.positionCount++;
    group.invoiceIds.add(row.invoiceId);
    group.invoiceCount = group.invoiceIds.size;
  });
  const groups: ArticleGroup[] = [...grouped.values()].map(({ invoiceIds: _ids, ...group }) => group)
    .sort((a, b) => a.description.localeCompare(b.description, "de") || a.supplier.localeCompare(b.supplier, "de"));
  return {
    invalidRange: filters.scope === "period" && invalidRange,
    invoiceCount: supplierScoped.length,
    matchingInvoiceCount: new Set(rows.map((row) => row.invoiceId)).size,
    missingPositionsCount: supplierScoped.filter((invoice) => !invoice.positionen?.length).length,
    undatedCount: invoices.filter((invoice) => !invoice.datum).length,
    rows, groups,
  };
}
