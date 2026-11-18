import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useListBookingTemplates,
  useListDueBookings,
  useUpdateBookingTemplate,
  useConfirmDueBooking,
  getListDueBookingsQueryKey,
  getListBookingTemplatesQueryKey,
  type BookingTemplate,
  type BookingTemplateInput,
  type DueBooking,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { CalendarClock, Check, Loader2, Lock, Pause, Pencil, Play, Square, RotateCw } from "lucide-react";
import { BookingFields } from "./BookingFields";
import { invalidateBookingQueries } from "./ManualBookingDialog";
import { formatNumber } from "@/lib/format";
import {
  apiErrorMessage, berlinToday, buildBooking, draftFromBooking, formatGermanDate,
  INTERVAL_LABELS, TEMPLATE_STATUS_LABELS, type BookingDraft, type DraftErrors,
} from "@/lib/manual-booking";

export function useDueBookings() {
  return useListDueBookings({ query: { queryKey: getListDueBookingsQueryKey(), refetchInterval: 30_000 } });
}

function amountOf(b: { bruttoBetrag?: number | null; waehrung?: string | null }) {
  return b.bruttoBetrag == null ? "—" : `${formatNumber(b.bruttoBetrag)} ${b.waehrung ?? ""}`;
}

const statusTone = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  paused: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  ended: "bg-muted text-muted-foreground border-border",
} as const;

function TemplateEditor({ template, onClose }: { template: BookingTemplate; onClose: () => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<BookingDraft>(() => draftFromBooking(template.booking));
  const [startDate, setStartDate] = useState(template.startDate);
  const [interval, setInterval] = useState(template.intervalMonths);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [serverError, setServerError] = useState<string>();
  const update = useUpdateBookingTemplate({
    mutation: {
      onSuccess: async () => { await invalidateBookingQueries(qc); toast.success("Vorlage gespeichert. Gilt für noch nicht bestätigte Termine."); onClose(); },
      onError: (e) => setServerError(apiErrorMessage(e, "Vorlage konnte nicht gespeichert werden.")),
    },
  });
  const locked = template.scheduleLocked;
  const save = () => {
    if (update.isPending) return;
    setServerError(undefined);
    const { data, errors: errs } = buildBooking({ ...draft, datum: startDate }, { includeStatus: false });
    setErrors(errs);
    if (!data) return;
    if (!locked && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) { setServerError("Bitte ein gültiges Startdatum wählen."); return; }
    update.mutate({ id: template.id, data: {
      booking: data, status: template.status,
      startDate: locked ? template.startDate : startDate,
      intervalMonths: locked ? template.intervalMonths : interval,
    } });
  };
  return (
    <div className="space-y-4" data-testid={`editor-template-${template.id}`}>
      <div className="rounded-md border border-border p-3 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-muted/20">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Startdatum
          <input type="date" value={startDate} disabled={locked || update.isPending} onChange={(e) => setStartDate(e.target.value)}
            className="border border-border rounded px-2 py-1.5 text-sm bg-background disabled:opacity-60" data-testid="input-template-start" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Intervall
          <select value={interval} disabled={locked || update.isPending} onChange={(e) => setInterval(Number(e.target.value) as 1 | 3 | 12)}
            className="border border-border rounded px-2 py-1.5 text-sm bg-background disabled:opacity-60" data-testid="select-template-interval">
            {([1, 3, 12] as const).map((i) => <option key={i} value={i}>{INTERVAL_LABELS[i]}</option>)}
          </select>
        </label>
        {locked && <p className="sm:col-span-2 text-xs text-muted-foreground flex items-center gap-1"><Lock className="h-3 w-3" /> Start und Intervall sind gesperrt, weil bereits ein Termin bestätigt wurde.</p>}
      </div>
      <BookingFields idPrefix={`tpl-${template.id}`} draft={draft} errors={errors} disabled={update.isPending} showStatus={false} showDate={false}
        onChange={(p) => { setDraft((d) => ({ ...d, ...p })); setServerError(undefined); }} />
      <p className="text-xs text-muted-foreground">Änderungen wirken nur auf noch nicht bestätigte Termine. Bereits erzeugte Buchungen bleiben unverändert.</p>
      {serverError && <p role="alert" className="text-sm text-destructive">{serverError}</p>}
      <DialogFooter>
        <Button variant="ghost" disabled={update.isPending} onClick={onClose}>Zurück</Button>
        <Button onClick={save} disabled={update.isPending} data-testid="button-save-template">
          {update.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Vorlage speichern
        </Button>
      </DialogFooter>
    </div>
  );
}

export function RecurringBookingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"due" | "templates">("due");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [endTarget, setEndTarget] = useState<BookingTemplate | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busyTemplate, setBusyTemplate] = useState<number | null>(null);
  const templatesQ = useListBookingTemplates({ query: { queryKey: getListBookingTemplatesQueryKey(), refetchInterval: open ? 30_000 : false, refetchOnWindowFocus: true } });
  const dueQ = useDueBookings();
  const today = berlinToday();

  useEffect(() => { if (!open) setEditingId(null); }, [open]);

  const templates = templatesQ.data ?? [];
  const templateMap = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);
  const due = useMemo(() => [...(dueQ.data ?? [])].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.templateId - b.templateId), [dueQ.data]);

  const confirm = useConfirmDueBooking({
    mutation: {
      onSuccess: async (res) => {
        await invalidateBookingQueries(qc);
        if (res.alreadyConfirmed) toast.info("Dieser Termin wurde bereits bestätigt (z. B. in einer anderen Sitzung). Es wurde keine weitere Buchung angelegt.");
        else toast.success(`Buchung #${res.invoiceId ?? ""} angelegt – Status: nicht geprüft`);
      },
      onError: async (e) => { toast.error(apiErrorMessage(e, "Termin konnte nicht bestätigt werden.")); await invalidateBookingQueries(qc); },
      onSettled: () => setConfirming(null),
    },
  });
  const update = useUpdateBookingTemplate({
    mutation: {
      onSuccess: async (t) => { await invalidateBookingQueries(qc); toast.success(`Vorlage ${TEMPLATE_STATUS_LABELS[t.status].toLowerCase()}`); },
      onError: (e) => toast.error(apiErrorMessage(e, "Status konnte nicht geändert werden.")),
      onSettled: () => setBusyTemplate(null),
    },
  });

  const setStatus = (t: BookingTemplate, status: BookingTemplateInput["status"]) => {
    if (busyTemplate !== null) return;
    setBusyTemplate(t.id);
    update.mutate({ id: t.id, data: { booking: t.booking, startDate: t.startDate, intervalMonths: t.intervalMonths, status } });
  };
  const doConfirm = (d: DueBooking) => {
    if (confirming) return;
    setConfirming(`${d.templateId}:${d.dueDate}`);
    confirm.mutate({ id: d.templateId, data: { dueDate: d.dueDate } });
  };

  const editing = editingId != null ? templateMap.get(editingId) : undefined;
  useEffect(() => {
    if (editingId == null || !templatesQ.data) return;
    if (!editing || editing.status === "ended") {
      setEditingId(null);
      toast.info("Die Vorlage wurde inzwischen beendet oder entfernt und ist schreibgeschützt.");
    }
  }, [editingId, editing, templatesQ.data]);

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!update.isPending && !confirm.isPending) onOpenChange(o); }}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-primary" /> Wiederkehrende Buchungen</DialogTitle>
            <DialogDescription>Nichts wird automatisch gebucht. Jeder Termin wird erst durch Ihre Bestätigung zur ungeprüften Buchung. Kalender: Europa/Berlin.</DialogDescription>
          </DialogHeader>

          {editing && editing.status !== "ended" ? (
            <TemplateEditor key={editing.id} template={editing} onClose={() => setEditingId(null)} />
          ) : (
            <>
              <div className="flex gap-1 border-b border-border">
                {([["due", `Fällig (${due.length})`], ["templates", `Vorlagen (${templates.length})`]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setTab(k)} data-testid={`tab-${k}`}
                    className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === k ? "border-primary text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{l}</button>
                ))}
              </div>

              {tab === "due" && (
                dueQ.isLoading ? <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 rounded bg-muted animate-pulse" />)}</div>
                : dueQ.isError ? (
                  <div className="text-sm text-destructive flex items-center gap-2">Fällige Termine konnten nicht geladen werden.
                    <Button size="sm" variant="outline" onClick={() => void dueQ.refetch()}><RotateCw className="h-3.5 w-3.5 mr-1" />Erneut</Button></div>
                ) : due.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    <CalendarClock className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    Keine fälligen Termine. Pausierte Vorlagen zeigen ihre Termine erst nach dem Fortsetzen.
                  </div>
                ) : (
                  <ul className="divide-y divide-border rounded-md border border-border" data-testid="list-due">
                    {due.map((d) => {
                      const key = `${d.templateId}:${d.dueDate}`;
                      const overdue = d.dueDate < today;
                      return (
                        <li key={key} className="flex items-center gap-3 px-3 py-2.5" data-testid={`row-due-${key}`}>
                          <div className="w-24 shrink-0">
                            <div className="font-mono text-sm">{formatGermanDate(d.dueDate)}</div>
                            <div className={`text-[11px] ${overdue ? "text-amber-700 dark:text-amber-400 font-medium" : "text-muted-foreground"}`}>{overdue ? "überfällig" : "heute fällig"}</div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{d.booking.buchungstext}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              Vorlage #{d.templateId}{d.booking.rechnungssteller ? ` · ${d.booking.rechnungssteller}` : ""}{d.booking.buchungskonto1 ? ` · Konto ${d.booking.buchungskonto1}` : ""}
                            </div>
                          </div>
                          <div className="font-mono text-sm shrink-0">{amountOf(d.booking)}</div>
                          <Button size="sm" onClick={() => doConfirm(d)} disabled={confirming !== null} data-testid={`button-confirm-${key}`}>
                            {confirming === key ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1" />}
                            Bestätigen
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )
              )}

              {tab === "templates" && (
                templatesQ.isLoading ? <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-14 rounded bg-muted animate-pulse" />)}</div>
                : templatesQ.isError ? (
                  <div className="text-sm text-destructive flex items-center gap-2">Vorlagen konnten nicht geladen werden.
                    <Button size="sm" variant="outline" onClick={() => void templatesQ.refetch()}><RotateCw className="h-3.5 w-3.5 mr-1" />Erneut</Button></div>
                ) : templates.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">Noch keine Vorlagen. Legen Sie eine über „Buchung ohne Beleg" mit der Option „Als wiederkehrende Buchung" an.</div>
                ) : (
                  <ul className="divide-y divide-border rounded-md border border-border" data-testid="list-templates">
                    {templates.map((t) => {
                      const busy = busyTemplate === t.id;
                      const dueCount = due.filter((d) => d.templateId === t.id).length;
                      return (
                        <li key={t.id} className={`px-3 py-2.5 flex items-center gap-3 flex-wrap ${t.status === "ended" ? "opacity-70" : ""}`} data-testid={`row-template-${t.id}`}>
                          <div className="flex-1 min-w-[200px]">
                            <div className="flex items-center gap-2">
                              <span className={`text-[11px] px-1.5 py-0.5 rounded border ${statusTone[t.status]}`}>{TEMPLATE_STATUS_LABELS[t.status]}</span>
                              <span className="text-sm font-medium truncate">{t.booking.buchungstext}</span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                              #{t.id} · {INTERVAL_LABELS[t.intervalMonths]} ab {formatGermanDate(t.startDate)}
                              {t.scheduleLocked && <Lock className="h-3 w-3" aria-label="Zeitplan gesperrt" />}
                              {dueCount > 0 && <span className="text-amber-700 dark:text-amber-400">· {dueCount} fällig</span>}
                            </div>
                          </div>
                          <div className="font-mono text-sm">{amountOf(t.booking)}</div>
                          {t.status !== "ended" && (
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" onClick={() => setEditingId(t.id)} disabled={busy} data-testid={`button-edit-template-${t.id}`}><Pencil className="h-3.5 w-3.5 mr-1" />Bearbeiten</Button>
                              {t.status === "active" ? (
                                <Button size="sm" variant="ghost" onClick={() => setStatus(t, "paused")} disabled={busyTemplate !== null} data-testid={`button-pause-template-${t.id}`}>
                                  {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Pause className="h-3.5 w-3.5 mr-1" />}Pausieren</Button>
                              ) : (
                                <Button size="sm" variant="ghost" onClick={() => setStatus(t, "active")} disabled={busyTemplate !== null} data-testid={`button-resume-template-${t.id}`}>
                                  {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}Fortsetzen</Button>
                              )}
                              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setEndTarget(t)} disabled={busyTemplate !== null} data-testid={`button-end-template-${t.id}`}>
                                <Square className="h-3.5 w-3.5 mr-1" />Beenden</Button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!endTarget} onOpenChange={(o) => { if (!o) setEndTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Vorlage endgültig beenden?</AlertDialogTitle>
            <AlertDialogDescription>
              „{endTarget?.booking.buchungstext}" wird dauerhaft beendet und kann nicht fortgesetzt werden. Alle noch nicht bestätigten Termine entfallen. Bereits erzeugte Buchungen bleiben erhalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-end" className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (endTarget) setStatus(endTarget, "ended"); setEndTarget(null); }}>Endgültig beenden</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
