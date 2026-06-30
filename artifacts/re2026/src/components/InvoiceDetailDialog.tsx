import { useState, useEffect, useRef, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
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
import { FileText, Loader2, Crosshair, ChevronLeft, ChevronRight } from "lucide-react";

// Worker served from /public so the browser can load it without Vite bundling issues
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

// ─── Field labels ─────────────────────────────────────────────────────────────
const CAPTURE_FIELDS: { key: keyof Invoice; label: string }[] = [
  { key: "rechnungssteller", label: "Rechnungssteller" },
  { key: "rechnungsnummer",  label: "Rechnungsnummer" },
  { key: "datum",            label: "Datum" },
  { key: "bruttoBetrag",     label: "Brutto" },
  { key: "steuersatz",       label: "MwSt %" },
  { key: "steuerBetrag",     label: "Steuer" },
  { key: "nettoBetrag",      label: "Netto" },
  { key: "waehrung",         label: "Währung" },
  { key: "buchungstext",     label: "Buchungstext" },
  { key: "bemerkung",        label: "Bemerkung" },
  { key: "freifeld1",        label: "Feld 1" },
  { key: "freifeld2",        label: "Feld 2" },
  { key: "freifeld3",        label: "Feld 3" },
];

// ─── Single editable field with capture button ───────────────────────────────
function DetailField({
  label,
  fieldKey,
  value,
  type = "text",
  onSave,
  captureField,
  onStartCapture,
  className = "",
}: {
  label: string;
  fieldKey: keyof Invoice;
  value: string | number | null | undefined;
  type?: "text" | "date";
  onSave: (v: string | null) => void;
  captureField: keyof Invoice | null;
  onStartCapture: (k: keyof Invoice) => void;
  className?: string;
}) {
  const [local, setLocal] = useState(value != null ? String(value) : "");
  useEffect(() => { setLocal(value != null ? String(value) : ""); }, [value]);

  const isCapturing = captureField === fieldKey;

  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
        {label}
        <button
          type="button"
          title={isCapturing ? "Warten auf Markierung…" : "Text aus PDF übernehmen"}
          onClick={() => onStartCapture(fieldKey)}
          className={`ml-auto p-0.5 rounded transition-colors ${
            isCapturing
              ? "text-blue-600 bg-blue-100 dark:bg-blue-900/40 animate-pulse"
              : "text-muted-foreground/40 hover:text-blue-500"
          }`}
        >
          <Crosshair className="h-3 w-3" />
        </button>
      </label>
      <input
        type={type}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => onSave(local.trim() || null)}
        className={`border rounded px-2 py-1 text-sm bg-background focus:outline-none focus:ring-1 w-full transition-all ${
          isCapturing
            ? "border-blue-400 ring-2 ring-blue-200 dark:ring-blue-800"
            : "border-border focus:ring-primary/50"
        }`}
      />
    </div>
  );
}

// ─── PDF Viewer ───────────────────────────────────────────────────────────────
function PdfViewer({
  invoiceId,
  captureField,
  onCapture,
}: {
  invoiceId: number;
  captureField: keyof Invoice | null;
  onCapture: (text: string) => void;
}) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [width, setWidth] = useState(600);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - 32));
    ro.observe(el);
    setWidth(el.clientWidth - 32);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setPage(1);
    setLoading(true);
    setError(false);
    setNumPages(null);
  }, [invoiceId]);

  const handleMouseUp = useCallback(() => {
    if (!captureField) return;
    const text = window.getSelection()?.toString().trim();
    if (text) onCapture(text);
  }, [captureField, onCapture]);

  const captureLabel = CAPTURE_FIELDS.find((f) => f.key === captureField)?.label;

  return (
    <div ref={containerRef} className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {captureField && (
        <div className="mx-4 mt-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-300 dark:border-blue-700 rounded text-xs text-blue-700 dark:text-blue-300 flex items-center gap-2 shrink-0">
          <Crosshair className="h-3.5 w-3.5 shrink-0 animate-pulse" />
          Text markieren → wird in <strong>{captureLabel}</strong> übernommen
        </div>
      )}

      {numPages && numPages > 1 && (
        <div className="flex items-center justify-center gap-2 py-1 text-xs text-muted-foreground shrink-0">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="p-1 rounded hover:bg-muted disabled:opacity-30"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span>Seite {page} / {numPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(numPages, p + 1))}
            disabled={page === numPages}
            className="p-1 rounded hover:bg-muted disabled:opacity-30"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div
        className={`flex-1 overflow-y-auto px-4 pb-4 select-text ${captureField ? "cursor-text" : ""}`}
        onMouseUp={handleMouseUp}
      >
        {loading && !error && (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/40" />
          </div>
        )}
        {error && (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
            <FileText className="h-10 w-10 mb-2 opacity-20" />
            <p className="text-sm">PDF konnte nicht geladen werden</p>
          </div>
        )}
        <Document
          file={`/api/invoices/${invoiceId}/pdf`}
          onLoadSuccess={({ numPages: n }) => { setNumPages(n); setLoading(false); }}
          onLoadError={() => { setLoading(false); setError(true); }}
          loading={null}
          noData={null}
          error={null}
        >
          {!loading && !error && (
            <Page
              pageNumber={page}
              width={width > 0 ? width : undefined}
              renderAnnotationLayer={false}
              renderTextLayer
              className="shadow-sm"
            />
          )}
        </Document>
      </div>
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
  // ALL hooks must come before any conditional return
  const queryClient = useQueryClient();
  const { data: lieferanten = [] } = useListLieferanten();
  const [captureField, setCaptureField] = useState<keyof Invoice | null>(null);

  useEffect(() => { if (!open) setCaptureField(null); }, [open]);

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

  const handleUpdate = (field: keyof Invoice, rawValue: string | null) => {
    if (!invoice) return;
    let parsedValue: string | number | null = rawValue;
    if (["bruttoBetrag", "steuersatz", "steuerBetrag", "nettoBetrag"].includes(field as string)) {
      parsedValue = rawValue ? (parseFloat(rawValue.replace(",", ".")) || null) : null;
    } else if (field === "lieferantId") {
      parsedValue = rawValue ? parseInt(rawValue, 10) : null;
    }
    updateMutation.mutate({ id: invoice.id, data: { [field]: parsedValue } });
  };

  const handleCapture = useCallback((text: string) => {
    if (!captureField || !invoice) return;
    const label = CAPTURE_FIELDS.find((f) => f.key === captureField)?.label ?? String(captureField);
    updateMutation.mutate({
      id: invoice.id,
      data: { [captureField]: text },
    });
    toast.success(`"${text.slice(0, 40)}${text.length > 40 ? "…" : ""}" → ${label}`);
    setCaptureField(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureField, invoice?.id]);

  // Conditional return AFTER all hooks
  if (!invoice) return null;

  const fieldProps = (key: keyof Invoice) => ({
    fieldKey: key,
    captureField,
    onStartCapture: (k: keyof Invoice) => setCaptureField((prev) => (prev === k ? null : k)),
    onSave: (v: string | null) => handleUpdate(key, v),
  });

  const title = invoice.rechnungssteller || invoice.dateiname || `Rechnung #${invoice.id}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] p-0 gap-0 flex overflow-hidden">
        <DialogTitle className="sr-only">{title}</DialogTitle>

        {/* ── Left: PDF viewer ─────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-border overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-muted/20 flex items-center gap-2 shrink-0">
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium text-muted-foreground truncate">
              {invoice.dateiname ?? "PDF Vorschau"}
            </span>
          </div>

          {invoice.dropboxFileId ? (
            <PdfViewer
              invoiceId={invoice.id}
              captureField={captureField}
              onCapture={handleCapture}
            />
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

        {/* ── Right: form ──────────────────────────────────────────────── */}
        <div className="w-[400px] shrink-0 flex flex-col overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-muted/20 shrink-0">
            <p className="text-sm font-semibold truncate">{title}</p>
            <p className="text-xs text-muted-foreground">Rechnung #{invoice.id}</p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <DetailField label="Rechnungssteller" value={invoice.rechnungssteller} {...fieldProps("rechnungssteller")} />

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
              <DetailField label="Datum" value={invoice.datum} type="date" {...fieldProps("datum")} />
              <DetailField label="Rechnungsnummer" value={invoice.rechnungsnummer} {...fieldProps("rechnungsnummer")} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <DetailField label="Brutto" value={invoice.bruttoBetrag != null ? formatNumber(invoice.bruttoBetrag) : null} {...fieldProps("bruttoBetrag")} />
              <DetailField label="MwSt %" value={invoice.steuersatz != null ? String(invoice.steuersatz) : null} {...fieldProps("steuersatz")} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <DetailField label="Steuer" value={invoice.steuerBetrag != null ? formatNumber(invoice.steuerBetrag) : null} {...fieldProps("steuerBetrag")} />
              <DetailField label="Netto" value={invoice.nettoBetrag != null ? formatNumber(invoice.nettoBetrag) : null} {...fieldProps("nettoBetrag")} />
            </div>

            <DetailField label="Währung" value={invoice.waehrung} {...fieldProps("waehrung")} />

            <div className="border-t border-border pt-3 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Buchung &amp; Notizen</p>
              <DetailField label="Buchungstext" value={invoice.buchungstext} {...fieldProps("buchungstext")} />
              <DetailField label="Bemerkung" value={invoice.bemerkung} {...fieldProps("bemerkung")} />
            </div>

            <div className="border-t border-border pt-3 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Freifelder</p>
              <DetailField label="Feld 1" value={invoice.freifeld1} {...fieldProps("freifeld1")} />
              <DetailField label="Feld 2" value={invoice.freifeld2} {...fieldProps("freifeld2")} />
              <DetailField label="Feld 3" value={invoice.freifeld3} {...fieldProps("freifeld3")} />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
