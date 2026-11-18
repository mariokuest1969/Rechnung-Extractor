import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CalendarClock, FilePlus2 } from "lucide-react";
import { ManualBookingDialog } from "./ManualBookingDialog";
import { RecurringBookingsDialog, useDueBookings } from "./RecurringBookingsDialog";
import { berlinToday } from "@/lib/manual-booking";

export function ManualBookingsBar() {
  const [manualOpen, setManualOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const { data: due = [] } = useDueBookings();
  const today = berlinToday();
  const overdue = due.filter((d) => d.dueDate < today).length;

  return (
    <div className="bg-card rounded-lg border border-border px-4 py-3 flex items-center gap-3 flex-wrap shadow-sm">
      <div className="mr-auto">
        <p className="text-sm font-semibold">Buchungen ohne Beleg</p>
        <p className="text-xs text-muted-foreground">Manuell erfassen oder wiederkehrende Termine einzeln bestätigen.</p>
      </div>
      <Button variant="outline" size="sm" onClick={() => setRecurringOpen(true)} data-testid="button-open-recurring"
        className={due.length ? "border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800" : ""}>
        <CalendarClock className="h-4 w-4 mr-1" /> Wiederkehrende Buchungen
        {due.length > 0 && (
          <span className="ml-1.5 rounded-full bg-amber-600 text-white text-[11px] px-1.5 py-0.5 font-mono" data-testid="text-due-count"
            title={overdue ? `${overdue} überfällig` : undefined}>{due.length} fällig</span>
        )}
      </Button>
      <Button size="sm" onClick={() => setManualOpen(true)} data-testid="button-manual-booking">
        <FilePlus2 className="h-4 w-4 mr-1" /> Buchung ohne Beleg
      </Button>
      <ManualBookingDialog open={manualOpen} onOpenChange={setManualOpen} />
      <RecurringBookingsDialog open={recurringOpen} onOpenChange={setRecurringOpen} />
    </div>
  );
}

export const HERKUNFT_LABELS = { pdf: "PDF", manual: "Ohne Beleg", recurring: "Wiederkehrend" } as const;

export function OriginBadge({ herkunft, vorlageId }: { herkunft?: "pdf" | "manual" | "recurring"; vorlageId?: number | null }) {
  if (!herkunft || herkunft === "pdf") return null;
  return (
    <span data-testid="badge-origin"
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${herkunft === "manual" ? "border-sky-300 bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800" : "border-violet-300 bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800"}`}>
      {HERKUNFT_LABELS[herkunft]}{herkunft === "recurring" && vorlageId ? ` #${vorlageId}` : ""}
    </span>
  );
}
