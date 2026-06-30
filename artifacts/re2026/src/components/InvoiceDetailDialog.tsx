import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Invoice,
  useUpdateInvoice,
  useListLieferanten,
  getListInvoicesQueryKey,
  getGetInvoiceStatsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatNumber } from "@/lib/format";
import { FileText, Loader2 } from "lucide-react";

// ─── Inline-edit field ───────────────────────────────────────────────────────
function DetailField({
  label,
  value,
  type = "text",
  onSave,
  className = "",
}: {
  label: string;
  value: string | number | null | undefined;
  type?: "text" | "date";
  onSave: (v: string | null) => void;
  className?: string;
}) {
  const [local, setLocal] = useState(value != null ? String(value) : "");
  useEffect(() => { setLocal(value != null ? String(value) : ""); }, [value]);

  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input
        type={type}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => onSave(local.trim() || null)}
        className="border border-border rounded px-2 py-1 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary/50 w-full"
      />
    </div>
  );
}

// ─── Main Dialog ─────────────────────────────────────────────────────────────
export function InvoiceDetailDialog({
  invoice,
  open,
  onOpenChange,
}: {
  invoice: Invoice | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: lieferanten = [] } = useListLieferanten();
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pdfError, setPdfError] = useState(false);

  // Reset PDF state when invoice changes
  useEffect(() => {
    setPdfLoading(true);
    setPdfError(false);
  }, [invoice?.id]);

  const updateMutation = useUpdateInvoice({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetInvoiceStatsQueryKey() });
        toast.success("Gespeichert");
      },
      onError: () => toast.error("Fehler beim Speichern"),
    },
  });

  if (!invoice) return null;

  const handleUpdate = (field: keyof Invoice, rawValue: string | null) => {
    let parsedValue: string | number | null = rawValue;
    if (["bruttoBetrag", "steuersatz", "steuerBetrag", "nettoBetrag"].includes(field as string)) {
      if (rawValue) {
        parsedValue = parseFloat(rawValue.replace(",", "."));
        if (isNaN(parsedValue as number)) parsedValue = null;
      } else {
        parsedValue = null;
      }
    } else if (field === "lieferantId") {
      parsedValue = rawValue ? parseInt(rawValue, 10) : null;
    }
    updateMutation.mutate({ id: invoice.id, data: { [field]: parsedValue } });
  };

  const hasPdf = !!invoice.dropboxFileId;
  const title = invoice.rechnungssteller || invoice.dateiname || `Rechnung #${invoice.id}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] p-0 gap-0 flex overflow-hidden">
        <DialogTitle className="sr-only">{title}</DialogTitle>

        {/* ── Left: PDF preview ─────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-border">
          <div className="px-4 py-2.5 border-b border-border bg-muted/20 flex items-center gap-2 shrink-0">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground truncate">
              {invoice.dateiname ?? "PDF Vorschau"}
            </span>
          </div>

          {hasPdf ? (
            <div className="flex-1 relative">
              {pdfLoading && !pdfError && (
                <div className="absolute inset-0 flex items-center justify-center bg-muted/20">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/50" />
                </div>
              )}
              {pdfError ? (
                <div className="flex-1 flex items-center justify-center h-full text-muted-foreground text-sm">
                  <div className="text-center">
                    <FileText className="h-12 w-12 mx-auto mb-2 opacity-20" />
                    <p>PDF konnte nicht geladen werden</p>
                  </div>
                </div>
              ) : (
                <iframe
                  key={invoice.id}
                  src={`/api/invoices/${invoice.id}/pdf`}
                  className="w-full h-full"
                  title="PDF Vorschau"
                  onLoad={() => setPdfLoading(false)}
                  onError={() => { setPdfLoading(false); setPdfError(true); }}
                />
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              <div className="text-center">
                <FileText className="h-12 w-12 mx-auto mb-2 opacity-20" />
                <p className="font-medium">Keine PDF verknüpft</p>
                <p className="text-xs mt-1 opacity-60">Nur Dropbox-Rechnungen können angezeigt werden</p>
              </div>
            </div>
          )}
        </div>

        {/* ── Right: editable form ──────────────────────────────────────── */}
        <div className="w-[400px] shrink-0 flex flex-col">
          <div className="px-4 py-2.5 border-b border-border bg-muted/20 shrink-0">
            <p className="text-sm font-semibold truncate">{title}</p>
            <p className="text-xs text-muted-foreground">Rechnung #{invoice.id}</p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <DetailField
              label="Rechnungssteller"
              value={invoice.rechnungssteller}
              onSave={(v) => handleUpdate("rechnungssteller", v)}
              className="col-span-2"
            />

            {/* Lieferant select */}
            <div className="flex flex-col gap-0.5">
              <label className="text-xs font-medium text-muted-foreground">Lieferant</label>
              <select
                value={invoice.lieferantId != null ? String(invoice.lieferantId) : ""}
                onChange={(e) => handleUpdate("lieferantId", e.target.value || null)}
                className="border border-border rounded px-2 py-1 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary/50 w-full"
              >
                <option value="">— keiner —</option>
                {lieferanten.map((l) => (
                  <option key={l.id} value={String(l.id)}>
                    {l.name}{l.kuerzel ? ` (${l.kuerzel})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <DetailField
                label="Datum"
                value={invoice.datum}
                type="date"
                onSave={(v) => handleUpdate("datum", v)}
              />
              <DetailField
                label="Rechnungsnummer"
                value={invoice.rechnungsnummer}
                onSave={(v) => handleUpdate("rechnungsnummer", v)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <DetailField
                label="Brutto"
                value={invoice.bruttoBetrag != null ? formatNumber(invoice.bruttoBetrag) : null}
                onSave={(v) => handleUpdate("bruttoBetrag", v)}
              />
              <DetailField
                label="MwSt %"
                value={invoice.steuersatz != null ? String(invoice.steuersatz) : null}
                onSave={(v) => handleUpdate("steuersatz", v)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <DetailField
                label="Steuer"
                value={invoice.steuerBetrag != null ? formatNumber(invoice.steuerBetrag) : null}
                onSave={(v) => handleUpdate("steuerBetrag", v)}
              />
              <DetailField
                label="Netto"
                value={invoice.nettoBetrag != null ? formatNumber(invoice.nettoBetrag) : null}
                onSave={(v) => handleUpdate("nettoBetrag", v)}
              />
            </div>

            <DetailField
              label="Währung"
              value={invoice.waehrung}
              onSave={(v) => handleUpdate("waehrung", v)}
            />

            <div className="border-t border-border pt-3 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Buchung &amp; Notizen</p>
              <DetailField
                label="Buchungstext"
                value={invoice.buchungstext}
                onSave={(v) => handleUpdate("buchungstext", v)}
              />
              <DetailField
                label="Bemerkung"
                value={invoice.bemerkung}
                onSave={(v) => handleUpdate("bemerkung", v)}
              />
            </div>

            <div className="border-t border-border pt-3 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Freifelder</p>
              <DetailField
                label="Feld 1"
                value={invoice.freifeld1}
                onSave={(v) => handleUpdate("freifeld1", v)}
              />
              <DetailField
                label="Feld 2"
                value={invoice.freifeld2}
                onSave={(v) => handleUpdate("freifeld2", v)}
              />
              <DetailField
                label="Feld 3"
                value={invoice.freifeld3}
                onSave={(v) => handleUpdate("freifeld3", v)}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
