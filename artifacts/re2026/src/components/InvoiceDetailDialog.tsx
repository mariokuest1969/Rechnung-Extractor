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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { FileText, Loader2, Crosshair, ChevronLeft, ChevronRight, X, Calculator } from "lucide-react";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

// ─── Column ID type (matches InvoiceTable) ────────────────────────────────────
type ColId =
  | "dateiname" | "rechnungssteller" | "lieferant" | "datum" | "rnr"
  | "brutto" | "mwst" | "steuer" | "netto" | "waehrung"
  | "buchung" | "bemerkung" | "freifeld1" | "freifeld2" | "freifeld3";

// ─── Field labels for PDF capture ─────────────────────────────────────────────
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

const MWST_RATES = [0, 7, 19];

// ─── Auto-calc helper ─────────────────────────────────────────────────────────
function calcFromBruttoAndRate(brutto: number, rate: number) {
  const netto = brutto / (1 + rate / 100);
  const steuer = brutto - netto;
  return {
    nettoBetrag: Math.round(netto * 100) / 100,
    steuerBetrag: Math.round(steuer * 100) / 100,
  };
}

// ─── Generic editable field ───────────────────────────────────────────────────
let _datalistCounter = 0;

function DetailField({
  label,
  fieldKey,
  value,
  type = "text",
  onSave,
  captureField,
  onStartCapture,
  suggestions,
  className = "",
  readOnly = false,
}: {
  label: string;
  fieldKey: keyof Invoice;
  value: string | number | null | undefined;
  type?: "text" | "date";
  onSave: (v: string | null) => void;
  captureField: keyof Invoice | null;
  onStartCapture: (k: keyof Invoice) => void;
  suggestions?: string[];
  className?: string;
  readOnly?: boolean;
}) {
  const [local, setLocal] = useState(value != null ? String(value) : "");
  const listId = useRef(`dl-${fieldKey}-${++_datalistCounter}`).current;

  useEffect(() => { setLocal(value != null ? String(value) : ""); }, [value]);

  const isCapturing = captureField === fieldKey;
  const hasSuggestions = suggestions && suggestions.length > 0;

  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
        {label}
        {!readOnly && (
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
        )}
      </label>
      <input
        type={type}
        value={local}
        list={hasSuggestions ? listId : undefined}
        readOnly={readOnly}
        onChange={(e) => { if (!readOnly) setLocal(e.target.value); }}
        onBlur={() => { if (!readOnly) onSave(local.trim() || null); }}
        className={`border rounded px-2 py-1 text-sm bg-background focus:outline-none focus:ring-1 w-full transition-all ${
          readOnly
            ? "bg-muted/30 text-muted-foreground cursor-default border-border/50"
            : isCapturing
              ? "border-blue-400 ring-2 ring-blue-200 dark:ring-blue-800"
              : "border-border focus:ring-primary/50"
        }`}
      />
      {hasSuggestions && !readOnly && (
        <datalist id={listId}>
          {suggestions!.map((s) => <option key={s} value={s} />)}
        </datalist>
      )}
    </div>
  );
}

// ─── MwSt % field with dropdown + auto-calc indicator ─────────────────────────
function MwStField({
  value,
  onSave,
  captureField,
  onStartCapture,
  hasAutoCalc,
}: {
  value: string | number | null | undefined;
  onSave: (v: string | null) => void;
  captureField: keyof Invoice | null;
  onStartCapture: (k: keyof Invoice) => void;
  hasAutoCalc: boolean;
}) {
  const [local, setLocal] = useState(value != null ? String(value) : "");
  useEffect(() => { setLocal(value != null ? String(value) : ""); }, [value]);

  const isCapturing = captureField === "steuersatz";
  const numVal = parseFloat(local);
  const isPreset = MWST_RATES.includes(numVal);
  const selectVal = isPreset ? String(numVal) : (local ? "custom" : "");

  const commitRate = (v: string) => { onSave(v.trim() || null); };

  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
        MwSt %
        {hasAutoCalc && (
          <span className="ml-1 inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400" title="Steuer und Netto werden automatisch berechnet">
            <Calculator className="h-2.5 w-2.5" />
          </span>
        )}
        <button
          type="button"
          title={isCapturing ? "Warten auf Markierung…" : "Text aus PDF übernehmen"}
          onClick={() => onStartCapture("steuersatz")}
          className={`ml-auto p-0.5 rounded transition-colors ${
            isCapturing
              ? "text-blue-600 bg-blue-100 dark:bg-blue-900/40 animate-pulse"
              : "text-muted-foreground/40 hover:text-blue-500"
          }`}
        >
          <Crosshair className="h-3 w-3" />
        </button>
      </label>

      <div className="flex gap-1.5">
        {/* Dropdown for preset rates */}
        <Select
          value={selectVal}
          onValueChange={(v) => {
            if (v !== "custom") {
              setLocal(v);
              commitRate(v);
            }
          }}
        >
          <SelectTrigger className={`h-8 w-24 shrink-0 text-sm ${isCapturing ? "border-blue-400 ring-2 ring-blue-200 dark:ring-blue-800" : ""}`}>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {MWST_RATES.map((r) => (
              <SelectItem key={r} value={String(r)}>{r} %</SelectItem>
            ))}
            <SelectItem value="custom">Sonstige…</SelectItem>
          </SelectContent>
        </Select>

        {/* Free-text input for custom rate */}
        <input
          type="text"
          inputMode="decimal"
          value={local}
          placeholder="z.B. 10.7"
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => commitRate(local)}
          className={`flex-1 border rounded px-2 py-1 text-sm bg-background focus:outline-none focus:ring-1 w-full transition-all ${
            isCapturing
              ? "border-blue-400 ring-2 ring-blue-200 dark:ring-blue-800"
              : "border-border focus:ring-primary/50"
          }`}
        />
      </div>
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
    setPage(1); setLoading(true); setError(false); setNumPages(null);
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
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1 rounded hover:bg-muted disabled:opacity-30">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span>Seite {page} / {numPages}</span>
          <button onClick={() => setPage((p) => Math.min(numPages, p + 1))} disabled={page === numPages} className="p-1 rounded hover:bg-muted disabled:opacity-30">
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
          loading={null} noData={null} error={null}
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

// ─── Main Dialog ──────────────────────────────────────────────────────────────
export function InvoiceDetailDialog({
  invoice,
  open,
  onOpenChange,
  hiddenCols = new Set(),
}: {
  invoice: Invoice | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  hiddenCols?: Set<ColId>;
}) {
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

  // ── Update with optional auto-calc ────────────────────────────────────────
  const handleUpdate = useCallback((field: keyof Invoice, rawValue: string | null) => {
    if (!invoice) return;

    let parsedValue: string | number | null = rawValue;
    if (["bruttoBetrag", "steuersatz", "steuerBetrag", "nettoBetrag"].includes(field as string)) {
      parsedValue = rawValue ? (parseFloat(rawValue.replace(",", ".")) || null) : null;
    } else if (field === "lieferantId") {
      parsedValue = rawValue ? parseInt(rawValue, 10) : null;
    }

    const updates: Record<string, string | number | null> = { [field]: parsedValue };

    // Auto-calculate Steuer + Netto when Brutto or Steuersatz changes
    if (field === "bruttoBetrag" || field === "steuersatz") {
      const brutto =
        field === "bruttoBetrag"
          ? (parsedValue as number | null)
          : invoice.bruttoBetrag;
      const rate =
        field === "steuersatz"
          ? (parsedValue as number | null)
          : (invoice.steuersatz != null ? parseFloat(String(invoice.steuersatz)) : null);

      if (brutto != null && rate != null && !isNaN(brutto) && !isNaN(rate)) {
        const { nettoBetrag, steuerBetrag } = calcFromBruttoAndRate(brutto, rate);
        updates.nettoBetrag = nettoBetrag;
        updates.steuerBetrag = steuerBetrag;
      }
    }

    updateMutation.mutate({ id: invoice.id, data: updates });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id, invoice?.bruttoBetrag, invoice?.steuersatz]);

  const handleCapture = useCallback((text: string) => {
    if (!captureField || !invoice) return;
    const label = CAPTURE_FIELDS.find((f) => f.key === captureField)?.label ?? String(captureField);
    // For numeric capture fields, also trigger auto-calc if applicable
    handleUpdate(captureField, text);
    toast.success(`"${text.slice(0, 40)}${text.length > 40 ? "…" : ""}" → ${label}`);
    setCaptureField(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureField, handleUpdate]);

  if (!invoice) return null;

  const show = (colId: ColId) => !hiddenCols.has(colId);

  const fieldProps = (key: keyof Invoice) => ({
    fieldKey: key,
    captureField,
    onStartCapture: (k: keyof Invoice) => setCaptureField((prev) => (prev === k ? null : k)),
    onSave: (v: string | null) => handleUpdate(key, v),
  });

  const title = invoice.rechnungssteller || invoice.dateiname || `Rechnung #${invoice.id}`;

  // Check which sections have at least one visible field
  const showBrutto  = show("brutto");
  const showMwst    = show("mwst");
  const showSteuer  = show("steuer");
  const showNetto   = show("netto");
  const showAmounts = showBrutto || showMwst || showSteuer || showNetto;
  const showNotizenSection = show("buchung") || show("bemerkung");
  const showFreiSection = show("freifeld1") || show("freifeld2") || show("freifeld3");

  // Whether brutto+mwst are both present → auto-calc is active
  const hasAutoCalc = invoice.bruttoBetrag != null && invoice.steuersatz != null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[96vw] w-[96vw] h-[92vh] p-0 gap-0 flex overflow-hidden"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>

        {/* ── Left: PDF viewer ─────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-border overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-muted/20 flex items-center gap-2 shrink-0">
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium text-muted-foreground truncate">
              {invoice.dateiname ?? "PDF Vorschau"}
            </span>
          </div>
          {invoice.dropboxFileId ? (
            <PdfViewer invoiceId={invoice.id} captureField={captureField} onCapture={handleCapture} />
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

        {/* ── Right: form ──────────────────────────────────────────────────── */}
        <div className="w-[420px] shrink-0 flex flex-col overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-muted/20 shrink-0 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{title}</p>
              <p className="text-xs text-muted-foreground">Rechnung #{invoice.id}</p>
            </div>
            <button
              onClick={() => onOpenChange(false)}
              className="shrink-0 p-1 rounded hover:bg-muted/60 text-muted-foreground transition-colors mt-0.5"
              title="Schließen"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* Rechnungssteller */}
            {show("rechnungssteller") && (
              <DetailField label="Rechnungssteller" value={invoice.rechnungssteller} {...fieldProps("rechnungssteller")} />
            )}

            {/* Lieferant */}
            {show("lieferant") && (
              <div className="flex flex-col gap-0.5">
                <label className="text-xs font-medium text-muted-foreground">Lieferant</label>
                <Select
                  value={invoice.lieferantId != null ? String(invoice.lieferantId) : "none"}
                  onValueChange={(v) => handleUpdate("lieferantId", v === "none" ? null : v)}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="— keiner —" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— keiner —</SelectItem>
                    {lieferanten.map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>
                        {l.name}{l.kuerzel ? ` (${l.kuerzel})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Datum + RNR */}
            {(show("datum") || show("rnr")) && (
              <div className={`grid gap-3 ${show("datum") && show("rnr") ? "grid-cols-2" : "grid-cols-1"}`}>
                {show("datum") && (
                  <DetailField label="Datum" value={invoice.datum} type="date" {...fieldProps("datum")} />
                )}
                {show("rnr") && (
                  <DetailField label="Rechnungsnummer" value={invoice.rechnungsnummer} {...fieldProps("rechnungsnummer")} />
                )}
              </div>
            )}

            {/* Beträge */}
            {showAmounts && (
              <>
                {/* Brutto + MwSt % row */}
                {(showBrutto || showMwst) && (
                  <div className={`grid gap-3 ${showBrutto && showMwst ? "grid-cols-2" : "grid-cols-1"}`}>
                    {showBrutto && (
                      <DetailField
                        label="Brutto"
                        value={invoice.bruttoBetrag != null ? formatNumber(invoice.bruttoBetrag) : null}
                        {...fieldProps("bruttoBetrag")}
                      />
                    )}
                    {showMwst && (
                      <MwStField
                        value={invoice.steuersatz != null ? String(invoice.steuersatz) : null}
                        onSave={(v) => handleUpdate("steuersatz", v)}
                        captureField={captureField}
                        onStartCapture={(k) => setCaptureField((prev) => (prev === k ? null : k))}
                        hasAutoCalc={hasAutoCalc}
                      />
                    )}
                  </div>
                )}

                {/* Steuer + Netto row (auto-filled) */}
                {(showSteuer || showNetto) && (
                  <div className={`grid gap-3 ${showSteuer && showNetto ? "grid-cols-2" : "grid-cols-1"}`}>
                    {showSteuer && (
                      <DetailField
                        label={hasAutoCalc ? "Steuer (auto)" : "Steuer"}
                        value={invoice.steuerBetrag != null ? formatNumber(invoice.steuerBetrag) : null}
                        readOnly={hasAutoCalc}
                        {...fieldProps("steuerBetrag")}
                      />
                    )}
                    {showNetto && (
                      <DetailField
                        label={hasAutoCalc ? "Netto (auto)" : "Netto"}
                        value={invoice.nettoBetrag != null ? formatNumber(invoice.nettoBetrag) : null}
                        readOnly={hasAutoCalc}
                        {...fieldProps("nettoBetrag")}
                      />
                    )}
                  </div>
                )}

                {/* Auto-calc hint */}
                {hasAutoCalc && (showSteuer || showNetto) && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 -mt-1">
                    <Calculator className="h-3 w-3" />
                    Steuer und Netto werden automatisch aus Brutto × MwSt % berechnet.
                  </p>
                )}
              </>
            )}

            {/* Währung */}
            {show("waehrung") && (
              <DetailField label="Währung" value={invoice.waehrung} {...fieldProps("waehrung")} />
            )}

            {/* Buchung & Notizen */}
            {showNotizenSection && (
              <div className="border-t border-border pt-3 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Buchung &amp; Notizen</p>
                {show("buchung") && (
                  <DetailField label="Buchungstext" value={invoice.buchungstext} {...fieldProps("buchungstext")} />
                )}
                {show("bemerkung") && (
                  <DetailField label="Bemerkung" value={invoice.bemerkung} {...fieldProps("bemerkung")} />
                )}
              </div>
            )}

            {/* Freifelder */}
            {showFreiSection && (
              <div className="border-t border-border pt-3 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Freifelder</p>
                {show("freifeld1") && (
                  <DetailField label="Feld 1" value={invoice.freifeld1} {...fieldProps("freifeld1")} />
                )}
                {show("freifeld2") && (
                  <DetailField label="Feld 2" value={invoice.freifeld2} {...fieldProps("freifeld2")} />
                )}
                {show("freifeld3") && (
                  <DetailField label="Feld 3" value={invoice.freifeld3} {...fieldProps("freifeld3")} />
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
