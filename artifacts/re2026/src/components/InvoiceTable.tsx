import { useListInvoices, useUpdateInvoice, useDeleteInvoice, getListInvoicesQueryKey, getGetInvoiceStatsQueryKey, Invoice } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EditableCell } from "./EditableCell";
import { formatNumber, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { exportInvoicesToCSV } from "@/lib/csv";

export function InvoiceTable() {
  const { data: invoices, isLoading } = useListInvoices();
  const queryClient = useQueryClient();

  const updateMutation = useUpdateInvoice({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetInvoiceStatsQueryKey() });
        toast.success("Gespeichert");
      },
      onError: () => toast.error("Fehler beim Speichern")
    }
  });

  const deleteMutation = useDeleteInvoice({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetInvoiceStatsQueryKey() });
        toast.success("Rechnung gelöscht");
      },
      onError: () => toast.error("Fehler beim Löschen")
    }
  });

  const handleUpdate = (id: number, field: keyof Invoice, value: string | null) => {
    let parsedValue: any = value;
    
    // Auto-parse numbers
    if (["bruttoBetrag", "steuersatz", "steuerBetrag", "nettoBetrag"].includes(field)) {
      if (value) {
        parsedValue = parseFloat(value.replace(",", "."));
        if (isNaN(parsedValue)) parsedValue = null;
      }
    }

    updateMutation.mutate({ id, data: { [field]: parsedValue } });
  };

  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border border-border p-8 flex items-center justify-center min-h-[300px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
      </div>
    );
  }

  if (!invoices || invoices.length === 0) {
    return (
      <div className="bg-card rounded-lg border border-border p-12 text-center">
        <h3 className="text-lg font-medium text-foreground mb-2">Keine Rechnungen vorhanden</h3>
        <p className="text-muted-foreground text-sm">Laden Sie PDFs hoch, um zu beginnen.</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden flex flex-col shadow-sm">
      <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">Erfasste Rechnungen</h2>
        <Button variant="outline" size="sm" onClick={() => exportInvoicesToCSV(invoices)}>
          CSV Export
        </Button>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-muted-foreground bg-muted/30 border-b border-border">
            <tr>
              <th className="px-4 py-3 font-medium whitespace-nowrap">Dateiname</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">Rechnungssteller</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">Datum</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">RNR</th>
              <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Brutto</th>
              <th className="px-4 py-3 font-medium text-right whitespace-nowrap">MwSt %</th>
              <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Steuer</th>
              <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Netto</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">Währung</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">Bemerkung</th>
              <th className="px-4 py-3 font-medium text-center w-12">Aktion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {invoices.map((inv) => (
              <tr key={inv.id} className="hover:bg-muted/10 transition-colors group">
                <td className="px-4 py-2 text-xs truncate max-w-[120px] text-muted-foreground" title={inv.dateiname || ""}>
                  {inv.dateiname}
                </td>
                <td className="px-4 py-2 font-medium">
                  <EditableCell 
                    value={inv.rechnungssteller} 
                    onSave={(v) => handleUpdate(inv.id, "rechnungssteller", v)} 
                  />
                </td>
                <td className="px-4 py-2">
                  <EditableCell 
                    type="date"
                    value={inv.datum} 
                    onSave={(v) => handleUpdate(inv.id, "datum", v)} 
                    className="font-mono text-xs"
                  />
                </td>
                <td className="px-4 py-2">
                  <EditableCell 
                    value={inv.rechnungsnummer} 
                    onSave={(v) => handleUpdate(inv.id, "rechnungsnummer", v)} 
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  <EditableCell 
                    type="number"
                    value={inv.bruttoBetrag != null ? formatNumber(inv.bruttoBetrag) : null} 
                    onSave={(v) => handleUpdate(inv.id, "bruttoBetrag", v)} 
                    className="font-mono text-right"
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  <EditableCell 
                    type="number"
                    value={inv.steuersatz} 
                    onSave={(v) => handleUpdate(inv.id, "steuersatz", v)} 
                    className="font-mono text-right"
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  <EditableCell 
                    type="number"
                    value={inv.steuerBetrag != null ? formatNumber(inv.steuerBetrag) : null} 
                    onSave={(v) => handleUpdate(inv.id, "steuerBetrag", v)} 
                    className="font-mono text-right text-muted-foreground"
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  <EditableCell 
                    type="number"
                    value={inv.nettoBetrag != null ? formatNumber(inv.nettoBetrag) : null} 
                    onSave={(v) => handleUpdate(inv.id, "nettoBetrag", v)} 
                    className="font-mono text-right"
                  />
                </td>
                <td className="px-4 py-2">
                  <EditableCell 
                    value={inv.waehrung} 
                    onSave={(v) => handleUpdate(inv.id, "waehrung", v)} 
                  />
                </td>
                <td className="px-4 py-2">
                  <EditableCell 
                    value={inv.bemerkung} 
                    onSave={(v) => handleUpdate(inv.id, "bemerkung", v)} 
                  />
                </td>
                <td className="px-4 py-2 text-center">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Rechnung löschen?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Möchten Sie den Datensatz für {inv.rechnungssteller || inv.dateiname} wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                        <AlertDialogAction 
                          onClick={() => deleteMutation.mutate({ id: inv.id })}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Löschen
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
