import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getListInvoicesQueryKey,
  getGetInvoiceStatsQueryKey,
  InvoicePreview,
} from "@workspace/api-client-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle, AlertCircle } from "lucide-react";

type EditablePreview = {
  dateiname: string;
  rechnungssteller: string;
  datum: string;
  rechnungsnummer: string;
  bruttoBetrag: string;
  steuersatz: string;
  steuerBetrag: string;
  nettoBetrag: string;
  waehrung: string;
  bemerkung: string;
};

function toEditable(p: InvoicePreview): EditablePreview {
  return {
    dateiname: p.dateiname,
    rechnungssteller: p.rechnungssteller ?? "",
    datum: p.datum ?? "",
    rechnungsnummer: p.rechnungsnummer ?? "",
    bruttoBetrag: p.bruttoBetrag != null ? String(p.bruttoBetrag) : "",
    steuersatz: p.steuersatz != null ? String(p.steuersatz) : "",
    steuerBetrag: p.steuerBetrag != null ? String(p.steuerBetrag) : "",
    nettoBetrag: p.nettoBetrag != null ? String(p.nettoBetrag) : "",
    waehrung: p.waehrung ?? "EUR",
    bemerkung: p.bemerkung ?? "",
  };
}

function hasMissingFields(p: EditablePreview): boolean {
  return !p.rechnungssteller || !p.datum || !p.bruttoBetrag;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  previews: InvoicePreview[];
  onSaved: () => void;
  onRetry: (index: number) => Promise<void>;
  retryingIndex: number | null;
}

export function UploadReviewDialog({ open, onOpenChange, previews, onSaved, onRetry, retryingIndex }: Props) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<EditablePreview[]>(() => previews.map(toEditable));
  const [activeIdx, setActiveIdx] = useState(0);

  // reset rows when previews change
  const [lastPreviews, setLastPreviews] = useState(previews);
  if (previews !== lastPreviews) {
    setLastPreviews(previews);
    // Only the retried entry changes identity. Preserve corrections on other files.
    setRows(previous => previews.map((p, i) => p === lastPreviews[i] ? previous[i] : toEditable(p)));
  }

  const saveMutation = useMutation({
    mutationFn: async (data: EditablePreview[]) => {
      if (retryingIndex !== null || previews.some(p => p.status !== "success")) {
        throw new Error("Fehlgeschlagene Dateien müssen zuerst erneut ausgelesen werden.");
      }
      const res = await fetch("/api/invoices/upload-confirmed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          data.map((r, index) => ({
            status: "success",
            error: null,
            positionen: previews[index].positionen,
            dateiname: r.dateiname,
            rechnungssteller: r.rechnungssteller || null,
            datum: r.datum || null,
            rechnungsnummer: r.rechnungsnummer || null,
            bruttoBetrag: r.bruttoBetrag ? parseFloat(r.bruttoBetrag.replace(",", ".")) : null,
            steuersatz: r.steuersatz ? parseFloat(r.steuersatz.replace(",", ".")) : null,
            steuerBetrag: r.steuerBetrag ? parseFloat(r.steuerBetrag.replace(",", ".")) : null,
            nettoBetrag: r.nettoBetrag ? parseFloat(r.nettoBetrag.replace(",", ".")) : null,
            waehrung: r.waehrung || "EUR",
            bemerkung: r.bemerkung || null,
          }))
        ),
      });
      if (!res.ok) throw new Error("Speichern fehlgeschlagen");
      return res.json();
    },
    onSuccess: (data: unknown[]) => {
      queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetInvoiceStatsQueryKey() });
      onSaved();
      toast.success(`${data.length} Rechnung${data.length !== 1 ? "en" : ""} gespeichert`);
    },
    onError: () => toast.error("Fehler beim Speichern"),
  });

  const update = (field: keyof EditablePreview, value: string) => {
    setRows((rs) =>
      rs.map((r, i) => (i === activeIdx ? { ...r, [field]: value } : r))
    );
  };

  const active = rows[activeIdx];
  if (!active) return null;
  const failedCount = previews.filter(p => p.status !== "success").length;
  const failed = previews[activeIdx].status !== "success";
  const busy = saveMutation.isPending || retryingIndex !== null;

  const fieldLabel = (label: string, field: keyof EditablePreview, type = "text") => (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type={type}
        value={active[field]}
        onChange={(e) => update(field, e.target.value)}
        className={!active[field] && ["rechnungssteller", "datum", "bruttoBetrag"].includes(field)
          ? "border-yellow-400 bg-yellow-50 dark:bg-yellow-900/10"
          : ""}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Erkennungsmaske — Daten prüfen & korrigieren</DialogTitle>
        </DialogHeader>

        {failedCount > 0 && (
          <p role="alert" className="text-sm text-destructive">
            {failedCount} von {rows.length} Dateien konnten nicht ausgelesen werden.
            Speichern ist gesperrt, bis alle Dateien erfolgreich ausgelesen wurden.
          </p>
        )}
        {/* File tabs */}
        {rows.length > 1 && (
          <div className="flex gap-1 flex-wrap">
            {rows.map((r, i) => (
              <button
                key={i}
                onClick={() => setActiveIdx(i)}
                className={`text-xs px-2 py-1 rounded border transition-colors flex items-center gap-1 ${
                  i === activeIdx
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border hover:bg-muted/40"
                }`}
              >
                {previews[i].status !== "success" ? (
                  <><AlertCircle className="h-3 w-3 text-destructive" /><span>Fehlgeschlagen</span></>
                ) : hasMissingFields(r) ? (
                  <AlertCircle className="h-3 w-3 text-yellow-500" />
                ) : (
                  <CheckCircle className="h-3 w-3 text-green-500" />
                )}
                <span className="max-w-[100px] truncate">{r.dateiname}</span>
              </button>
            ))}
          </div>
        )}

        {/* Single file name */}
        {rows.length === 1 && (
          <p className="text-xs text-muted-foreground truncate">📄 {active.dateiname}</p>
        )}

        {/* Missing-field hint */}
        {!failed && hasMissingFields(active) && (
          <div className="flex items-center gap-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800/50 rounded px-3 py-2 text-xs text-yellow-800 dark:text-yellow-300">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Fehlende Pflichtfelder (gelb markiert) – bitte ausfüllen oder leer lassen.
          </div>
        )}

        {failed && (
          <div className="rounded border border-destructive/50 bg-destructive/5 p-4 space-y-3">
            <p className="text-sm font-medium break-all">{active.dateiname}</p>
            <p role="alert" className="text-sm text-destructive">{previews[activeIdx].error}</p>
            <Button variant="outline" disabled={busy} onClick={() => void onRetry(activeIdx)}>
              {retryingIndex === activeIdx && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {retryingIndex === activeIdx ? "Wird erneut ausgelesen…" : "Diese Datei erneut auslesen"}
            </Button>
          </div>
        )}

        {/* Form */}
        {!failed && <fieldset disabled={saveMutation.isPending} className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            {fieldLabel("Rechnungssteller *", "rechnungssteller")}
          </div>
          {fieldLabel("Datum *", "datum", "date")}
          {fieldLabel("Rechnungsnummer", "rechnungsnummer")}
          {fieldLabel("Bruttobetrag *", "bruttoBetrag", "number")}
          {fieldLabel("Steuersatz %", "steuersatz", "number")}
          {fieldLabel("Steuerbetrag", "steuerBetrag", "number")}
          {fieldLabel("Nettobetrag", "nettoBetrag", "number")}
          {fieldLabel("Währung", "waehrung")}
          <div className="col-span-2">
            {fieldLabel("Bemerkung", "bemerkung")}
          </div>
        </fieldset>}

        <DialogFooter className="gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          {activeIdx < rows.length - 1 && (
            <Button variant="outline" onClick={() => setActiveIdx((i) => i + 1)}>
              Nächste Datei →
            </Button>
          )}
          <Button
            onClick={() => saveMutation.mutate(rows)}
            disabled={busy || failedCount > 0}
          >
            {saveMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Speichern…</>
            ) : (
              `${rows.length} Rechnung${rows.length !== 1 ? "en" : ""} speichern`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
