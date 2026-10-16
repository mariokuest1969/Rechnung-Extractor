import { useEffect, useMemo, useState } from "react";
import {
  useListInvoiceDuplicates,
  useDeleteInvoiceDuplicates,
  getListInvoiceDuplicatesQueryKey,
  getListInvoicesQueryKey,
  getGetInvoiceStatsQueryKey,
  type Invoice,
  type InvoiceDuplicateGroup,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDate, formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";

const txt = (v: string | null | undefined) => (v && v.trim() ? v : "—");

function errorInfo(error: unknown): { status?: number; message: string } {
  const e = error as { status?: number; data?: { error?: string } | null; message?: string } | null;
  return {
    status: e?.status,
    message: e?.data?.error || e?.message || "Unbekannter Fehler",
  };
}

function Field({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`text-sm break-words ${mono ? "tabular-nums" : ""}`}>{children}</dd>
    </div>
  );
}

function InvoiceCard({
  inv, checked, disabled, disabledReason, onToggle, supplierName,
}: {
  inv: Invoice; checked: boolean; disabled: boolean; disabledReason?: string;
  onToggle: () => void; supplierName?: string;
}) {
  const id = `dup-${inv.id}`;
  const booking = [
    inv.buchungskonto1 && `${inv.buchungskonto1}${inv.buchungskonto1Betrag != null ? ` (${formatNumber(inv.buchungskonto1Betrag)})` : ""}`,
    inv.buchungskonto2 && `${inv.buchungskonto2}${inv.buchungskonto2Betrag != null ? ` (${formatNumber(inv.buchungskonto2Betrag)})` : ""}`,
  ].filter(Boolean).join(" · ");
  const extra = [inv.freifeld1, inv.freifeld2, inv.freifeld3].filter((v) => v && v.trim()).join(" · ");
  return (
    <li
      className={`rounded-lg border p-3 transition-colors ${
        checked
          ? "border-destructive/60 bg-destructive/5"
          : "border-emerald-600/30 bg-emerald-50/50 dark:bg-emerald-950/20"
      }`}
      data-testid={`duplicate-invoice-${inv.id}`}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onToggle}
          aria-describedby={disabledReason ? `${id}-reason` : undefined}
          className="mt-0.5"
          data-testid={`checkbox-duplicate-${inv.id}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor={id} className="min-w-0 cursor-pointer font-medium break-all">
              {txt(inv.dateiname)}
            </label>
            {checked ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                <Trash2 className="h-3 w-3" /> Wird gelöscht
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                <ShieldCheck className="h-3 w-3" /> Bleibt erhalten
              </span>
            )}
          </div>
          {disabledReason && (
            <p id={`${id}-reason`} className="mt-0.5 text-[11px] text-muted-foreground">{disabledReason}</p>
          )}
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <Field label="ID" mono>#{inv.id}</Field>
            <Field label="Rechnungssteller">{txt(inv.rechnungssteller)}</Field>
            <Field label="Lieferant">{txt(supplierName)}</Field>
            <Field label="RNR / Datum">{txt(inv.rechnungsnummer)} · {formatDate(inv.datum)}</Field>
            <Field label="Brutto" mono>{formatNumber(inv.bruttoBetrag)} {txt(inv.waehrung)}</Field>
            <Field label="Netto / Steuer" mono>
              {formatNumber(inv.nettoBetrag)} / {formatNumber(inv.steuerBetrag)}
              {inv.steuersatz != null ? ` (${inv.steuersatz} %)` : ""}
            </Field>
            <Field label="Positionen" mono>{inv.positionen?.length ?? 0}</Field>
            <Field label="Erfasst">{formatDate(inv.createdAt)}</Field>
            <Field label="Buchung">{booking || "—"}{inv.buchungstext ? ` · ${inv.buchungstext}` : ""}</Field>
            <Field label="Bemerkung">{txt(inv.bemerkung)}</Field>
            <Field label="Freifelder">{extra || "—"}</Field>
            <Field label="Dropbox">{inv.dropboxFileId ? "verknüpft" : "—"}</Field>
          </dl>
        </div>
      </div>
    </li>
  );
}

function GroupBlock({
  group, index, selected, onToggle, supplierNames, disabled,
}: {
  group: InvoiceDuplicateGroup; index: number; selected: Set<number>;
  onToggle: (id: number) => void; supplierNames: ReadonlyMap<number, string>; disabled: boolean;
}) {
  const selectedInGroup = group.invoices.filter((i) => selected.has(i.id)).length;
  const kept = group.invoices.length - selectedInGroup;
  const first = group.invoices[0];
  return (
    <section
      aria-labelledby={`dup-group-${index}`}
      className="rounded-xl border border-border bg-card p-3 sm:p-4"
      data-testid={`duplicate-group-${index}`}
    >
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`dup-group-${index}`} className="text-sm font-semibold">
          Gruppe {index + 1}: {txt(first?.rechnungssteller)} · RNR {txt(first?.rechnungsnummer)}
        </h3>
        <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {group.invoices.length} Einträge · {selectedInGroup} markiert · {kept} bleib{kept === 1 ? "t" : "en"}
        </p>
      </header>
      <ul className="space-y-2">
        {group.invoices.map((inv) => {
          const checked = selected.has(inv.id);
          const lastRetained = !checked && kept === 1;
          return (
            <InvoiceCard
              key={inv.id}
              inv={inv}
              checked={checked}
              disabled={disabled || lastRetained}
              disabledReason={lastRetained ? "Letzte verbleibende Kopie dieser Gruppe – kann nicht gelöscht werden." : undefined}
              onToggle={() => onToggle(inv.id)}
              supplierName={inv.lieferantId ? supplierNames.get(inv.lieferantId) : undefined}
            />
          );
        })}
      </ul>
    </section>
  );
}

export function DuplicateReviewDialog({
  open, onOpenChange, supplierNames,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  supplierNames: ReadonlyMap<number, string>;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useListInvoiceDuplicates({
    query: { enabled: open, queryKey: getListInvoiceDuplicatesQueryKey() },
  });

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setMutationError(null);
      setConfirmOpen(false);
      void refetch();
    }
    // only on open transitions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const groups = useMemo(() => data?.groups ?? [], [data]);

  // Drop selections that no longer exist in the current data
  useEffect(() => {
    const valid = new Set(groups.flatMap((g) => g.invoices.map((i) => i.id)));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [groups]);

  const deleteMutation = useDeleteInvoiceDuplicates({
    mutation: {
      onSuccess: async (res) => {
        setConfirmOpen(false);
        setSelected(new Set());
        setMutationError(null);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getListInvoiceDuplicatesQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetInvoiceStatsQueryKey() }),
        ]);
        toast.success(`${res.deleted} Kopie${res.deleted !== 1 ? "n" : ""} aus der Datenbank gelöscht`);
      },
      onError: (err) => {
        setConfirmOpen(false);
        const { status, message } = errorInfo(err);
        if (status === 409) {
          setSelected(new Set());
          setMutationError(`Die Daten haben sich inzwischen geändert. Es wurde nichts gelöscht. Die Gruppen wurden neu geladen – bitte erneut prüfen. (${message})`);
          void refetch();
        } else {
          setMutationError(`Löschen konnte nicht bestätigt werden. Bitte die Treffer neu laden, bevor du es erneut versuchst. (${message})`);
          setSelected(new Set());
          void refetch();
        }
        toast.error(status === 409 ? "Auswahl nicht mehr gültig – nichts gelöscht" : "Löschen nicht bestätigt – Treffer werden neu geladen");
      },
    },
  });
  const pending = deleteMutation.isPending;

  const toggle = (id: number) => {
    if (pending) return;
    const group = groups.find((g) => g.invoices.some((i) => i.id === id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        if (group && group.invoices.every((i) => i.id === id || next.has(i.id))) return prev;
        next.add(id);
      }
      return next;
    });
  };

  const selectedIds = [...selected];
  const count = selectedIds.length;
  const totalCopies = groups.reduce((s, g) => s + g.invoices.length, 0);

  const handleOpenChange = (o: boolean) => {
    if (!o && (pending || confirmOpen)) return;
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!confirmOpen && <DialogContent
        className="sm:max-w-5xl w-[calc(100vw-1.5rem)] max-h-[92dvh] overflow-y-auto flex flex-col gap-3 p-4 sm:p-6"
        onEscapeKeyDown={(e) => { if (pending) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (pending || confirmOpen) e.preventDefault(); }}
        onInteractOutside={(e) => { if (pending || confirmOpen) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>Mögliche Duplikate prüfen</DialogTitle>
          <DialogDescription>
            Geprüft werden alle Rechnungen, unabhängig von Filtern und Markierungen in der Tabelle.
            Eine Gruppe entsteht nur bei identischem Rechnungssteller, Rechnungsnummer, Rechnungsdatum,
            Bruttobetrag und Währung. Das ist ein Hinweis, kein Beweis – bitte jede Kopie vergleichen.
          </DialogDescription>
        </DialogHeader>

        {mutationError && (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="error-duplicate-delete">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{mutationError}</span>
          </div>
        )}

        {data && data.excludedCount > 0 && (
          <p className="flex items-start gap-1.5 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300" data-testid="text-duplicate-excluded">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            {data.excludedCount} Rechnung{data.excludedCount !== 1 ? "en wurden" : " wurde"} nicht geprüft, weil
            mindestens eines der Vergleichsmerkmale (Rechnungssteller, Nummer, Datum, Bruttobetrag, Währung) fehlt.
            Diese können trotzdem Duplikate sein.
          </p>
        )}

        <div className="min-h-[200px] flex-1 overflow-y-auto overscroll-contain -mx-1 px-1" aria-busy={isFetching}>
          {isLoading ? (
            <div className="space-y-3" data-testid="loading-duplicates">
              {[0, 1].map((i) => (
                <div key={i} className="rounded-xl border border-border p-4 space-y-3 animate-pulse">
                  <div className="h-4 w-1/3 rounded bg-muted" />
                  <div className="h-20 rounded-lg bg-muted/70" />
                  <div className="h-20 rounded-lg bg-muted/50" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div role="alert" className="p-8 text-center" data-testid="error-duplicates">
              <AlertTriangle className="mx-auto h-6 w-6 text-destructive" />
              <p className="mt-2 font-medium text-destructive">Duplikate konnten nicht geladen werden</p>
              <p className="mt-1 text-sm text-muted-foreground">{errorInfo(error).message}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => void refetch()} disabled={isFetching}>
                <RefreshCw className={`mr-1 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Erneut versuchen
              </Button>
            </div>
          ) : groups.length === 0 ? (
            <div className="p-8 text-center" data-testid="empty-duplicates">
              <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-600" />
              <p className="mt-2 font-medium">Keine möglichen Duplikate gefunden</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Keine Rechnungen stimmen in allen Vergleichsmerkmalen überein.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {groups.length} Gruppe{groups.length !== 1 ? "n" : ""} mit insgesamt {totalCopies} Einträgen.
                Nichts ist vorausgewählt – markieren Sie nur die Kopien, die gelöscht werden sollen.
                Pro Gruppe bleibt immer mindestens ein Eintrag erhalten.
              </p>
              {groups.map((g, i) => (
                <GroupBlock key={g.key} group={g} index={i} selected={selected} onToggle={toggle}
                  supplierNames={supplierNames} disabled={pending} />
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
            {count} Kopie{count !== 1 ? "n" : ""} zum Löschen markiert
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={pending}>Schließen</Button>
            <Button variant="outline" onClick={() => void refetch()} disabled={pending || isFetching}>
              <RefreshCw className={`mr-1 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Neu prüfen
            </Button>
            <Button variant="destructive" disabled={count === 0 || pending || isFetching}
              onClick={() => setConfirmOpen(true)} data-testid="button-delete-duplicates">
              {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1 h-4 w-4" />}
              {count} Kopie{count !== 1 ? "n" : ""} löschen
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>}

      {confirmOpen && (
        <DialogContent className="max-h-[92dvh] overflow-y-auto" onEscapeKeyDown={e => { e.preventDefault(); if (!pending) setConfirmOpen(false); }}
          onPointerDownOutside={e => e.preventDefault()} onInteractOutside={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{count} Kopie{count !== 1 ? "n" : ""} endgültig löschen?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Die markierten {count} Datenbankeinträge (IDs {selectedIds.map((id) => `#${id}`).join(", ")}) werden
                  dauerhaft gelöscht – einschließlich Positionen, Buchungsfeldern, Bemerkungen und Freifeldern.
                  Das kann nicht rückgängig gemacht werden.
                </p>
                <p>
                  Die Original-Dateien in Dropbox bleiben unverändert. Die gelöschten Dateien werden beim
                  nächsten Dropbox-Sync nicht erneut importiert.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setConfirmOpen(false)}>Abbrechen</Button>
            <Button variant="destructive" disabled={pending || count === 0}
              onClick={() => deleteMutation.mutate({ data: { ids: selectedIds } })}
              data-testid="button-confirm-delete-duplicates">
              {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Endgültig löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
