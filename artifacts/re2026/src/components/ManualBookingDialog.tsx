import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useCreateManualBooking,
  useCreateBookingTemplate,
  getListInvoicesQueryKey,
  getGetInvoiceStatsQueryKey,
  getListBookingTemplatesQueryKey,
  getListDueBookingsQueryKey,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Repeat } from "lucide-react";
import { BookingFields } from "./BookingFields";
import { apiErrorMessage, buildBooking, emptyDraft, INTERVAL_LABELS, type BookingDraft, type DraftErrors } from "@/lib/manual-booking";

export function invalidateBookingQueries(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() }),
    qc.invalidateQueries({ queryKey: getGetInvoiceStatsQueryKey() }),
    qc.invalidateQueries({ queryKey: getListBookingTemplatesQueryKey() }),
    qc.invalidateQueries({ queryKey: getListDueBookingsQueryKey() }),
  ]);
}

export function ManualBookingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<BookingDraft>(emptyDraft);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [recurring, setRecurring] = useState(false);
  const [interval, setInterval] = useState<1 | 3 | 12>(1);
  const [serverError, setServerError] = useState<string>();

  useEffect(() => {
    if (open) { setDraft(emptyDraft()); setErrors({}); setRecurring(false); setInterval(1); setServerError(undefined); }
  }, [open]);

  const createBooking = useCreateManualBooking({
    mutation: {
      onSuccess: async () => { await invalidateBookingQueries(qc); toast.success("Buchung ohne Beleg gespeichert"); onOpenChange(false); },
      onError: (e) => setServerError(apiErrorMessage(e, "Buchung konnte nicht gespeichert werden. Ihre Eingaben bleiben erhalten.")),
    },
  });
  const createTemplate = useCreateBookingTemplate({
    mutation: {
      onSuccess: async () => { await invalidateBookingQueries(qc); toast.success("Wiederkehrende Vorlage angelegt. Termine erscheinen erst nach Ihrer Bestätigung als Buchung."); onOpenChange(false); },
      onError: (e) => setServerError(apiErrorMessage(e, "Vorlage konnte nicht gespeichert werden. Ihre Eingaben bleiben erhalten.")),
    },
  });
  const pending = createBooking.isPending || createTemplate.isPending;

  const save = () => {
    if (pending) return;
    setServerError(undefined);
    const { data, errors: errs } = buildBooking(draft, { includeStatus: !recurring });
    setErrors(errs);
    if (!data) return;
    if (recurring) createTemplate.mutate({ data: { booking: data, startDate: data.datum, intervalMonths: interval, status: "active" } });
    else createBooking.mutate({ data });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!pending) onOpenChange(o); }}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Buchung ohne Beleg</DialogTitle>
          <DialogDescription>Manuell erfasst, ohne PDF. Jede Angabe stammt von Ihnen – nichts wird automatisch ergänzt.</DialogDescription>
        </DialogHeader>

        <BookingFields idPrefix="manual" draft={draft} errors={errors} disabled={pending} showStatus={!recurring}
          onChange={(p) => { setDraft((d) => ({ ...d, ...p })); setServerError(undefined); }} />

        <div className={`rounded-md border p-3 space-y-2 ${recurring ? "border-primary/40 bg-primary/5" : "border-border"}`}>
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <input type="checkbox" checked={recurring} disabled={pending} data-testid="checkbox-recurring"
              onChange={(e) => setRecurring(e.target.checked)} />
            <Repeat className="h-4 w-4 text-primary" /> Als wiederkehrende Buchung
          </label>
          {recurring && (
            <div className="space-y-2 pl-6">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground text-xs">Intervall</span>
                <select value={interval} disabled={pending} data-testid="select-interval"
                  onChange={(e) => setInterval(Number(e.target.value) as 1 | 3 | 12)}
                  className="border border-border rounded px-2 py-1 text-sm bg-background">
                  {([1, 3, 12] as const).map((i) => <option key={i} value={i}>{INTERVAL_LABELS[i]}</option>)}
                </select>
                <span className="text-xs text-muted-foreground">ab dem Datum oben (Kalender Europa/Berlin)</span>
              </div>
              <p className="text-xs text-muted-foreground">Es wird nur eine Vorlage gespeichert, <strong>keine Buchung</strong>. Jeder fällige Termin muss einzeln bestätigt werden und entsteht dann als ungeprüfte Buchung.</p>
            </div>
          )}
        </div>

        {serverError && <p role="alert" className="text-sm text-destructive" data-testid="text-manual-error">{serverError}</p>}
        <DialogFooter>
          <Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>Abbrechen</Button>
          <Button onClick={save} disabled={pending} data-testid="button-save-manual">
            {pending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {recurring ? "Vorlage speichern" : "Buchung speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
