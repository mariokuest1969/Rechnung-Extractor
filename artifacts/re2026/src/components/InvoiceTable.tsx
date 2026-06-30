import { useState, useMemo } from "react";
import {
  useListInvoices,
  useUpdateInvoice,
  useDeleteInvoice,
  useTriggerDropboxSync,
  useBulkUpdateInvoices,
  useReextractInvoice,
  useListLieferanten,
  getListInvoicesQueryKey,
  getGetInvoiceStatsQueryKey,
  getListLieferantenQueryKey,
  Invoice,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EditableCell } from "./EditableCell";
import { LieferantenDialog } from "./LieferantenDialog";
import { BuchungsDialog } from "./BuchungsDialog";
import { InvoiceDetailDialog } from "./InvoiceDetailDialog";
import { formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Trash2,
  Loader2,
  RefreshCw,
  Users,
  BookOpen,
  X,
  Sparkles,
  ExternalLink,
  ChevronUp,
  ChevronDown,
  Search,
  ChevronsUpDown,
} from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { exportInvoicesToCSV } from "@/lib/csv";
import { exportInvoicesToXLSX } from "@/lib/xlsx-export";

// ─────────────────────────────────────────────────────────────────────────────
// Bulk-edit dialog: Rechnungssteller / Lieferant
// ─────────────────────────────────────────────────────────────────────────────
function BulkEditDialog({
  open,
  onOpenChange,
  selectedIds,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  selectedIds: number[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: lieferanten = [] } = useListLieferanten();
  const [rechnungssteller, setRechnungssteller] = useState("");
  const [lieferantId, setLieferantId] = useState<string>("");

  const bulkMutation = useBulkUpdateInvoices({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetInvoiceStatsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListLieferantenQueryKey() });
        onOpenChange(false);
        onDone();
        toast.success(`${selectedIds.length} Rechnungen aktualisiert`);
      },
      onError: () => toast.error("Fehler beim Aktualisieren"),
    },
  });

  const handleSave = () => {
    const fields: Record<string, string | number | null> = {};
    if (rechnungssteller.trim()) fields.rechnungssteller = rechnungssteller.trim();
    if (lieferantId && lieferantId !== "none")
      fields.lieferantId = parseInt(lieferantId, 10);
    if (Object.keys(fields).length === 0) {
      toast.error("Bitte mindestens ein Feld ausfüllen");
      return;
    }
    bulkMutation.mutate({ data: { ids: selectedIds, fields } });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) { setRechnungssteller(""); setLieferantId(""); }
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {selectedIds.length} Zeile{selectedIds.length !== 1 ? "n" : ""} bearbeiten
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Rechnungssteller setzen
            </Label>
            <Input
              placeholder="Neuer Wert (leer = nicht ändern)"
              value={rechnungssteller}
              onChange={(e) => setRechnungssteller(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Lieferant zuweisen
            </Label>
            <Select value={lieferantId} onValueChange={setLieferantId}>
              <SelectTrigger>
                <SelectValue placeholder="Nicht ändern" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— nicht ändern —</SelectItem>
                {lieferanten.map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>
                    {l.name}
                    {l.kuerzel ? ` (${l.kuerzel})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={handleSave} disabled={bulkMutation.isPending}>
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main InvoiceTable
// ─────────────────────────────────────────────────────────────────────────────
export function InvoiceTable() {
  const { data: invoices, isLoading } = useListInvoices();
  const { data: lieferanten = [] } = useListLieferanten();
  const queryClient = useQueryClient();

  const lieferantenMap = useMemo(() => {
    const m = new Map<number, string>();
    lieferanten.forEach((l) => m.set(l.id, l.name));
    return m;
  }, [lieferanten]);

  // ── Filter state ──────────────────────────────────────────────────────────
  const [searchText, setSearchText] = useState("");
  const [filterLieferantId, setFilterLieferantId] = useState<string>("all");
  const [filterDatumVon, setFilterDatumVon] = useState("");
  const [filterDatumBis, setFilterDatumBis] = useState("");

  // ── Sort state ────────────────────────────────────────────────────────────
  type SortField = "lieferant" | "datum" | "rnr";
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  };

  // ── Filtered + sorted invoices ────────────────────────────────────────────
  const displayInvoices = useMemo(() => {
    let list = invoices ?? [];
    const q = searchText.trim().toLowerCase();
    if (q) {
      list = list.filter((inv) => {
        const lieferantName = inv.lieferantId ? (lieferantenMap.get(inv.lieferantId) ?? "") : "";
        return [
          inv.dateiname, inv.rechnungssteller, inv.rechnungsnummer,
          inv.bemerkung, inv.freifeld1, inv.freifeld2, inv.freifeld3,
          inv.datum, inv.waehrung, lieferantName,
        ].some((f) => f?.toLowerCase().includes(q));
      });
    }
    if (filterLieferantId !== "all") {
      const lid = Number(filterLieferantId);
      list = list.filter((inv) => inv.lieferantId === lid);
    }
    if (filterDatumVon) list = list.filter((inv) => (inv.datum ?? "") >= filterDatumVon);
    if (filterDatumBis) list = list.filter((inv) => (inv.datum ?? "") <= filterDatumBis);
    if (sortField) {
      list = [...list].sort((a, b) => {
        let va = "", vb = "";
        if (sortField === "lieferant") {
          va = a.lieferantId ? (lieferantenMap.get(a.lieferantId) ?? "") : "";
          vb = b.lieferantId ? (lieferantenMap.get(b.lieferantId) ?? "") : "";
        } else if (sortField === "datum") {
          va = a.datum ?? ""; vb = b.datum ?? "";
        } else if (sortField === "rnr") {
          va = a.rechnungsnummer ?? ""; vb = b.rechnungsnummer ?? "";
        }
        return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      });
    }
    return list;
  }, [invoices, searchText, filterLieferantId, filterDatumVon, filterDatumBis, sortField, sortDir, lieferantenMap]);

  const hasActiveFilter = searchText || filterLieferantId !== "all" || filterDatumVon || filterDatumBis;

  const clearFilters = () => {
    setSearchText(""); setFilterLieferantId("all"); setFilterDatumVon(""); setFilterDatumBis("");
  };

  // Selection
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const allIds = useMemo(() => displayInvoices.map((i) => i.id), [displayInvoices]);
  const allChecked = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someChecked = selected.size > 0 && !allChecked;

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const toggleAll = () =>
    setSelected(allChecked ? new Set() : new Set(allIds));

  // Dialogs
  const [lieferantenOpen, setLieferantenOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [buchungsOpen, setBuchungsOpen] = useState(false);
  const [buchungsInvoice, setBuchungsInvoice] = useState<Invoice | null>(null);
  const [detailInvoiceId, setDetailInvoiceId] = useState<number | null>(null);
  const detailInvoice = invoices?.find((i) => i.id === detailInvoiceId) ?? null;

  const openBulkBuchung = () => {
    setBuchungsInvoice(null);
    setBuchungsOpen(true);
  };

  const openSingleBuchung = (inv: Invoice) => {
    setBuchungsInvoice(inv);
    setBuchungsOpen(true);
  };

  // Mutations
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

  const deleteMutation = useDeleteInvoice({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetInvoiceStatsQueryKey() });
        toast.success("Rechnung gelöscht");
      },
      onError: () => toast.error("Fehler beim Löschen"),
    },
  });

  const reextractMutation = useReextractInvoice({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetInvoiceStatsQueryKey() });
        toast.success("Rechnung neu extrahiert");
      },
      onError: () => toast.error("Neu-Extraktion fehlgeschlagen"),
    },
  });

  const syncMutation = useTriggerDropboxSync({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetInvoiceStatsQueryKey() });
        toast.success(
          `Dropbox-Sync: ${data.imported} neu importiert, ${data.skipped} bereits vorhanden`
        );
      },
      onError: () => toast.error("Dropbox-Sync fehlgeschlagen"),
    },
  });

  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const handleBulkDelete = async () => {
    setIsBulkDeleting(true);
    try {
      const res = await fetch("/api/invoices/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      });
      if (!res.ok) throw new Error();
      const { deleted } = await res.json() as { deleted: number };
      queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetInvoiceStatsQueryKey() });
      setSelected(new Set());
      toast.success(`${deleted} Rechnung${deleted !== 1 ? "en" : ""} gelöscht`);
    } catch {
      toast.error("Fehler beim Löschen");
    } finally {
      setIsBulkDeleting(false);
      setBulkDeleteConfirmOpen(false);
    }
  };

  const openDropboxLink = async (id: number) => {
    try {
      const res = await fetch(`/api/invoices/${id}/dropbox-link`);
      if (!res.ok) { toast.error("Link konnte nicht erstellt werden"); return; }
      const { url } = await res.json() as { url: string };
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Fehler beim Öffnen der Datei");
    }
  };

  const handleUpdate = (id: number, field: keyof Invoice, value: string | null) => {
    let parsedValue: string | number | null = value;
    if (["bruttoBetrag", "steuersatz", "steuerBetrag", "nettoBetrag"].includes(field)) {
      if (value) {
        parsedValue = parseFloat(value.replace(",", "."));
        if (isNaN(parsedValue as number)) parsedValue = null;
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
        <p className="text-muted-foreground text-sm">
          Laden Sie PDFs hoch oder warten Sie auf den automatischen Dropbox-Scan.
        </p>
      </div>
    );
  }

  const selectedIds = Array.from(selected);

  return (
    <>
      <div className="bg-card rounded-lg border border-border overflow-hidden flex flex-col shadow-sm">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-base font-semibold text-foreground">Erfasste Rechnungen</h2>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLieferantenOpen(true)}
              title="Lieferantenverzeichnis"
            >
              <Users className="h-4 w-4 mr-1" />
              Lieferanten
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              {syncMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              Dropbox jetzt prüfen
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportInvoicesToCSV(invoices)}>
              CSV Export
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportInvoicesToXLSX(invoices)}>
              Excel Export
            </Button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="px-4 py-2 border-b border-border bg-muted/10 flex flex-wrap items-end gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Suche in allen Feldern…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="w-full pl-7 pr-2 py-1.5 text-sm border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground whitespace-nowrap">Lieferant</label>
            <select
              value={filterLieferantId}
              onChange={(e) => setFilterLieferantId(e.target.value)}
              className="text-sm border border-border rounded px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="all">Alle</option>
              {lieferanten.map((l) => (
                <option key={l.id} value={String(l.id)}>{l.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground whitespace-nowrap">Datum von</label>
            <input
              type="date"
              value={filterDatumVon}
              onChange={(e) => setFilterDatumVon(e.target.value)}
              className="text-sm border border-border rounded px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground whitespace-nowrap">bis</label>
            <input
              type="date"
              value={filterDatumBis}
              onChange={(e) => setFilterDatumBis(e.target.value)}
              className="text-sm border border-border rounded px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
          {hasActiveFilter && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title="Filter zurücksetzen"
            >
              <X className="h-3.5 w-3.5" /> Filter löschen
            </button>
          )}
          {hasActiveFilter && (
            <span className="text-xs text-muted-foreground ml-auto">
              {displayInvoices.length} von {invoices?.length ?? 0}
            </span>
          )}
        </div>

        {/* Bulk Action Bar */}
        {selected.size > 0 && (
          <div className="px-4 py-2 bg-primary/5 border-b border-primary/20 flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-primary">
              {selected.size} ausgewählt
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setBulkEditOpen(true)}
            >
              <Users className="h-3.5 w-3.5 mr-1" />
              Rechnungssteller / Lieferant setzen
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={openBulkBuchung}
            >
              <BookOpen className="h-3.5 w-3.5 mr-1" />
              Buchen
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const dropboxIds = selectedIds.filter(
                  (id) => invoices?.find((i) => i.id === id)?.dropboxFileId
                );
                if (dropboxIds.length === 0) {
                  toast.error("Nur Dropbox-Rechnungen können neu extrahiert werden");
                  return;
                }
                dropboxIds.forEach((id) => reextractMutation.mutate({ id }));
                toast.info(`${dropboxIds.length} Datei${dropboxIds.length !== 1 ? "en" : ""} werden neu extrahiert…`);
              }}
              disabled={reextractMutation.isPending}
            >
              <Sparkles className="h-3.5 w-3.5 mr-1" />
              Neu extrahieren (KI)
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setBulkDeleteConfirmOpen(true)}
              disabled={isBulkDeleting}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Löschen
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Auswahl aufheben
            </Button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground bg-muted/30 border-b border-border">
              <tr>
                <th className="px-3 py-3 w-8 text-center" title="PDF öffnen"></th>
                <th className="px-3 py-3 w-10">
                  <Checkbox
                    checked={allChecked}
                    data-state={someChecked ? "indeterminate" : allChecked ? "checked" : "unchecked"}
                    onCheckedChange={toggleAll}
                    aria-label="Alle auswählen"
                  />
                </th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Dateiname</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Rechnungssteller</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">
                  <button
                    onClick={() => toggleSort("lieferant")}
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    Lieferant
                    {sortField === "lieferant" ? (
                      sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                    ) : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">
                  <button
                    onClick={() => toggleSort("datum")}
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    Datum
                    {sortField === "datum" ? (
                      sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                    ) : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">
                  <button
                    onClick={() => toggleSort("rnr")}
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    RNR
                    {sortField === "rnr" ? (
                      sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                    ) : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Brutto</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">MwSt %</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Steuer</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Netto</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Währung</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Buchung</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Bemerkung</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Feld 1</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Feld 2</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Feld 3</th>
                <th className="px-4 py-3 font-medium text-center w-12">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {displayInvoices.length === 0 && (
                <tr>
                  <td colSpan={20} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Keine Rechnungen entsprechen den Filterkriterien.
                  </td>
                </tr>
              )}
              {displayInvoices.map((inv) => {
                const isSelected = selected.has(inv.id);
                const lieferantName = inv.lieferantId ? lieferantenMap.get(inv.lieferantId) : null;
                const hasBuchung = !!(inv.buchungskonto1 || inv.buchungskonto2);

                return (
                  <tr
                    key={inv.id}
                    className={`hover:bg-muted/30 transition-colors group cursor-pointer ${isSelected ? "bg-primary/5" : ""}`}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("input, button, [role=checkbox]")) return;
                      setDetailInvoiceId(inv.id);
                    }}
                  >
                    <td className="px-3 py-2 text-center">
                      {inv.dropboxFileId && (
                        <button
                          title="PDF in Dropbox öffnen"
                          onClick={(e) => { e.stopPropagation(); void openDropboxLink(inv.id); }}
                          className="text-blue-500 hover:text-blue-700 transition-colors"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggle(inv.id)}
                        aria-label={`Zeile ${inv.id} auswählen`}
                      />
                    </td>
                    <td
                      className="px-4 py-2 text-xs truncate max-w-[120px] text-muted-foreground"
                      title={inv.dateiname ?? ""}
                    >
                      {inv.dateiname}
                      {inv.dropboxFileId && (
                        <button
                          title="Mit KI neu extrahieren"
                          onClick={(e) => { e.stopPropagation(); reextractMutation.mutate({ id: inv.id }); }}
                          disabled={reextractMutation.isPending}
                          className="ml-1 text-muted-foreground/50 hover:text-primary transition-colors"
                        >
                          <Sparkles className="inline h-3 w-3" />
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2 font-medium">
                      <EditableCell
                        value={inv.rechnungssteller}
                        onSave={(v) => handleUpdate(inv.id, "rechnungssteller", v)}
                      />
                    </td>
                    <td className="px-4 py-2">
                      {lieferantName ? (
                        <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-medium">
                          {lieferantName}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/40 italic">—</span>
                      )}
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
                    {/* Buchungskonto */}
                    <td className="px-4 py-2">
                      <button
                        onClick={() => openSingleBuchung(inv)}
                        className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${
                          hasBuchung
                            ? "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400"
                            : "border-border text-muted-foreground/50 hover:border-primary/50 hover:text-primary"
                        }`}
                        title={
                          hasBuchung
                            ? `${inv.buchungskonto1 ?? ""}${inv.buchungskonto2 ? " / " + inv.buchungskonto2 : ""}`
                            : "Buchung erfassen"
                        }
                      >
                        {hasBuchung
                          ? `${inv.buchungskonto1 ?? "?"}${inv.buchungskonto2 ? "/" + inv.buchungskonto2 : ""}`
                          : "— buchen"}
                      </button>
                    </td>
                    <td className="px-4 py-2">
                      <EditableCell
                        value={inv.bemerkung}
                        onSave={(v) => handleUpdate(inv.id, "bemerkung", v)}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <EditableCell
                        value={inv.freifeld1 ?? null}
                        onSave={(v) => handleUpdate(inv.id, "freifeld1", v)}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <EditableCell
                        value={inv.freifeld2 ?? null}
                        onSave={(v) => handleUpdate(inv.id, "freifeld2", v)}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <EditableCell
                        value={inv.freifeld3 ?? null}
                        onSave={(v) => handleUpdate(inv.id, "freifeld3", v)}
                      />
                    </td>
                    <td className="px-4 py-2 text-center">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Rechnung löschen?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Möchten Sie den Datensatz für{" "}
                              {inv.rechnungssteller || inv.dateiname} wirklich löschen? Diese
                              Aktion kann nicht rückgängig gemacht werden.
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
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bulk Delete Confirmation */}
      <AlertDialog open={bulkDeleteConfirmOpen} onOpenChange={setBulkDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{selectedIds.length} Rechnung{selectedIds.length !== 1 ? "en" : ""} löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Diese Aktion löscht {selectedIds.length === 1 ? "die ausgewählte Rechnung" : `alle ${selectedIds.length} ausgewählten Rechnungen`} unwiderruflich aus der Datenbank.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isBulkDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Detail View Dialog */}
      <InvoiceDetailDialog
        invoice={detailInvoice}
        open={detailInvoiceId !== null}
        onOpenChange={(o) => { if (!o) setDetailInvoiceId(null); }}
      />

      {/* Dialogs */}
      <LieferantenDialog open={lieferantenOpen} onOpenChange={setLieferantenOpen} />
      <BulkEditDialog
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        selectedIds={selectedIds}
        onDone={() => setSelected(new Set())}
      />
      <BuchungsDialog
        open={buchungsOpen}
        onOpenChange={setBuchungsOpen}
        invoiceIds={buchungsInvoice ? [buchungsInvoice.id] : selectedIds}
        singleInvoice={buchungsInvoice}
      />
    </>
  );
}
