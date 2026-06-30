import { useState, useEffect } from "react";
import {
  useListBuchungskonten,
  useCreateBuchungskonto,
  useDeleteBuchungskonto,
  useBulkUpdateInvoices,
  useUpdateInvoice,
  getListInvoicesQueryKey,
  getGetInvoiceStatsQueryKey,
  getListBuchungskontenQueryKey,
  Invoice,
  Buchungskonto,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Trash2, Plus, ChevronDown } from "lucide-react";

interface BuchungszeileState {
  konto: string;
  bezeichnung: string;
  betrag: string;
}

const emptyZeile = (): BuchungszeileState => ({ konto: "", bezeichnung: "", betrag: "" });

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  invoiceIds: number[];
  singleInvoice?: Invoice | null;
}

function KontoSelector({
  value,
  onChange,
  buchungskonten,
}: {
  value: string;
  onChange: (konto: string, bezeichnung: string) => void;
  buchungskonten: Buchungskonto[];
}) {
  const [open, setOpen] = useState(false);
  const filtered = value
    ? buchungskonten.filter(
        (k) =>
          k.kontonummer.includes(value) ||
          k.bezeichnung.toLowerCase().includes(value.toLowerCase())
      )
    : buchungskonten;

  return (
    <Popover open={open && filtered.length > 0} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Input
            placeholder="Kontonr."
            value={value}
            onChange={(e) => {
              onChange(e.target.value, "");
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            className="pr-7"
          />
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        </div>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-64" align="start">
        <div className="max-h-48 overflow-y-auto divide-y divide-border">
          {filtered.map((k) => (
            <button
              key={k.id}
              className="w-full text-left px-3 py-2 hover:bg-muted/40 text-sm"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(k.kontonummer, k.bezeichnung);
                setOpen(false);
              }}
            >
              <span className="font-mono font-medium">{k.kontonummer}</span>
              <span className="text-muted-foreground ml-2 text-xs">{k.bezeichnung}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function BuchungsDialog({ open, onOpenChange, invoiceIds, singleInvoice }: Props) {
  const queryClient = useQueryClient();
  const { data: buchungskonten = [] } = useListBuchungskonten();
  const [zeile1, setZeile1] = useState<BuchungszeileState>(emptyZeile());
  const [zeile2, setZeile2] = useState<BuchungszeileState>(emptyZeile());
  const [buchungstext, setBuchungstext] = useState("");
  const [showKontenplan, setShowKontenplan] = useState(false);
  const [newKonto, setNewKonto] = useState({ kontonummer: "", bezeichnung: "" });

  useEffect(() => {
    if (open && singleInvoice) {
      setZeile1({
        konto: singleInvoice.buchungskonto1 ?? "",
        bezeichnung:
          buchungskonten.find((k) => k.kontonummer === singleInvoice.buchungskonto1)?.bezeichnung ?? "",
        betrag: singleInvoice.buchungskonto1Betrag != null ? String(singleInvoice.buchungskonto1Betrag) : "",
      });
      setZeile2({
        konto: singleInvoice.buchungskonto2 ?? "",
        bezeichnung:
          buchungskonten.find((k) => k.kontonummer === singleInvoice.buchungskonto2)?.bezeichnung ?? "",
        betrag: singleInvoice.buchungskonto2Betrag != null ? String(singleInvoice.buchungskonto2Betrag) : "",
      });
      setBuchungstext(singleInvoice.buchungstext ?? "");
    } else if (!open) {
      setZeile1(emptyZeile());
      setZeile2(emptyZeile());
      setBuchungstext("");
    }
  }, [open, singleInvoice, buchungskonten]);

  const invalidateInvoices = () => {
    queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetInvoiceStatsQueryKey() });
  };

  const bulkMutation = useBulkUpdateInvoices({
    mutation: {
      onSuccess: () => { invalidateInvoices(); onOpenChange(false); toast.success("Buchung gespeichert"); },
      onError: () => toast.error("Fehler beim Buchen"),
    },
  });

  const singleMutation = useUpdateInvoice({
    mutation: {
      onSuccess: () => { invalidateInvoices(); onOpenChange(false); toast.success("Buchung gespeichert"); },
      onError: () => toast.error("Fehler beim Buchen"),
    },
  });

  const createKontoMutation = useCreateBuchungskonto({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBuchungskontenQueryKey() });
        setNewKonto({ kontonummer: "", bezeichnung: "" });
        toast.success("Konto angelegt");
      },
      onError: () => toast.error("Fehler beim Anlegen"),
    },
  });

  const deleteKontoMutation = useDeleteBuchungskonto({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListBuchungskontenQueryKey() }),
    },
  });

  const handleSave = () => {
    const fields = {
      buchungskonto1: zeile1.konto || null,
      buchungskonto1Betrag: zeile1.betrag ? parseFloat(zeile1.betrag.replace(",", ".")) : null,
      buchungskonto2: zeile2.konto || null,
      buchungskonto2Betrag: zeile2.betrag ? parseFloat(zeile2.betrag.replace(",", ".")) : null,
      buchungstext: buchungstext || null,
    };

    if (invoiceIds.length === 1 && singleInvoice) {
      singleMutation.mutate({ id: invoiceIds[0]!, data: fields });
    } else {
      bulkMutation.mutate({ data: { ids: invoiceIds, fields } });
    }
  };

  const isPending = bulkMutation.isPending || singleMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Buchungsmaske
            {invoiceIds.length > 1 && (
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({invoiceIds.length} Rechnungen)
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Konto 1 */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Buchungskonto 1 (Sollkonto)
            </Label>
            <div className="grid grid-cols-[120px_1fr_100px] gap-2">
              <KontoSelector
                value={zeile1.konto}
                onChange={(konto, bezeichnung) =>
                  setZeile1((z) => ({ ...z, konto, bezeichnung: bezeichnung || z.bezeichnung }))
                }
                buchungskonten={buchungskonten}
              />
              <Input
                placeholder="Bezeichnung"
                value={zeile1.bezeichnung}
                onChange={(e) => setZeile1((z) => ({ ...z, bezeichnung: e.target.value }))}
              />
              <Input
                placeholder="Betrag"
                value={zeile1.betrag}
                onChange={(e) => setZeile1((z) => ({ ...z, betrag: e.target.value }))}
                className="font-mono"
              />
            </div>
          </div>

          {/* Konto 2 */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Buchungskonto 2 (Gegenkonto / Aufteilung)
            </Label>
            <div className="grid grid-cols-[120px_1fr_100px] gap-2">
              <KontoSelector
                value={zeile2.konto}
                onChange={(konto, bezeichnung) =>
                  setZeile2((z) => ({ ...z, konto, bezeichnung: bezeichnung || z.bezeichnung }))
                }
                buchungskonten={buchungskonten}
              />
              <Input
                placeholder="Bezeichnung"
                value={zeile2.bezeichnung}
                onChange={(e) => setZeile2((z) => ({ ...z, bezeichnung: e.target.value }))}
              />
              <Input
                placeholder="Betrag"
                value={zeile2.betrag}
                onChange={(e) => setZeile2((z) => ({ ...z, betrag: e.target.value }))}
                className="font-mono"
              />
            </div>
          </div>

          {/* Buchungstext */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Buchungstext
            </Label>
            <Input
              placeholder="Buchungstext / Verwendungszweck"
              value={buchungstext}
              onChange={(e) => setBuchungstext(e.target.value)}
            />
          </div>

          {/* Kontenplan */}
          <div>
            <button
              className="text-xs text-primary underline-offset-2 hover:underline"
              onClick={() => setShowKontenplan((v) => !v)}
            >
              {showKontenplan ? "▲ Kontenplan ausblenden" : "▼ Kontenplan verwalten"}
            </button>

            {showKontenplan && (
              <div className="mt-2 border border-border rounded-md overflow-hidden">
                <div className="max-h-44 overflow-y-auto divide-y divide-border">
                  {buchungskonten.length === 0 && (
                    <p className="text-xs text-muted-foreground p-3 text-center">Noch keine Konten</p>
                  )}
                  {buchungskonten.map((k) => (
                    <div key={k.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                      <span className="font-mono w-16 shrink-0">{k.kontonummer}</span>
                      <span className="flex-1 text-muted-foreground truncate">{k.bezeichnung}</span>
                      <button
                        onClick={() => deleteKontoMutation.mutate({ id: k.id })}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 p-2 border-t border-border bg-muted/20">
                  <Input
                    placeholder="Konto-Nr."
                    value={newKonto.kontonummer}
                    onChange={(e) => setNewKonto((k) => ({ ...k, kontonummer: e.target.value }))}
                    className="h-7 text-xs font-mono w-24"
                  />
                  <Input
                    placeholder="Bezeichnung"
                    value={newKonto.bezeichnung}
                    onChange={(e) => setNewKonto((k) => ({ ...k, bezeichnung: e.target.value }))}
                    className="h-7 text-xs flex-1"
                  />
                  <Button
                    size="sm"
                    className="h-7 px-2"
                    disabled={!newKonto.kontonummer.trim() || !newKonto.bezeichnung.trim()}
                    onClick={() => createKontoMutation.mutate({ data: newKonto })}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            Buchung speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
