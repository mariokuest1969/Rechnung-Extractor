import { useState, useMemo, useRef, useEffect } from "react";
import {
  useListInvoices,
  useUpdateInvoice,
  useDeleteInvoice,
  useTriggerDropboxSync,
  useTriggerDropboxCleanup,
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
  Columns,
  Check,
  Eye,
  EyeOff,
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
import { exportInvoicePositionsToCSV, exportInvoicesToCSV } from "@/lib/csv";
import { exportInvoicePositionsToXLSX, exportInvoicesToXLSX } from "@/lib/xlsx-export";

// ─────────────────────────────────────────────────────────────────────────────
// Column definitions
// ─────────────────────────────────────────────────────────────────────────────
const COLUMN_DEFS = [
  { id: "dateiname",        label: "Dateiname",        sortable: true,  align: "left"  },
  { id: "rechnungssteller", label: "Rechnungssteller",  sortable: true,  align: "left"  },
  { id: "lieferant",        label: "Lieferant",         sortable: true,  align: "left"  },
  { id: "datum",            label: "Datum",             sortable: true,  align: "left"  },
  { id: "rnr",              label: "RNR",               sortable: true,  align: "left"  },
  { id: "brutto",           label: "Brutto",            sortable: true,  align: "right" },
  { id: "mwst",             label: "MwSt %",            sortable: true,  align: "right" },
  { id: "steuer",           label: "Steuer",            sortable: true,  align: "right" },
  { id: "netto",            label: "Netto",             sortable: true,  align: "right" },
  { id: "waehrung",         label: "Währung",           sortable: true,  align: "left"  },
  { id: "buchung",          label: "Buchung",           sortable: false, align: "left"  },
  { id: "bemerkung",        label: "Bemerkung",         sortable: true,  align: "left"  },
  { id: "freifeld1",        label: "Feld 1",            sortable: true,  align: "left"  },
  { id: "freifeld2",        label: "Feld 2",            sortable: true,  align: "left"  },
  { id: "freifeld3",        label: "Feld 3",            sortable: true,  align: "left"  },
] as const;

type ColId = (typeof COLUMN_DEFS)[number]["id"];
type SortField = ColId;

// ─────────────────────────────────────────────────────────────────────────────
// Persistente Ansichtseinstellungen (localStorage)
// ─────────────────────────────────────────────────────────────────────────────
const VALID_COL_IDS = COLUMN_DEFS.map((c) => c.id) as readonly ColId[];
const isColId = (v: unknown): v is ColId => VALID_COL_IDS.includes(v as ColId);

const LS_KEYS = {
  hiddenCols: "re2026.view.hiddenCols",
  columnOrder: "re2026.view.columnOrder",
  sort: "re2026.view.sort",
} as const;

function lsRead<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function lsWrite(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Speicher nicht verfügbar — ignorieren */
  }
}

function loadHiddenCols(): Set<ColId> {
  const arr = lsRead<unknown[]>(LS_KEYS.hiddenCols);
  return new Set(Array.isArray(arr) ? arr.filter(isColId) : []);
}

// Gespeicherte Reihenfolge mit dem aktuellen Spaltensatz abgleichen:
// ungültige IDs verwerfen, fehlende (neue) Spalten hinten anhängen.
function loadColumnOrder(): ColId[] {
  const stored = lsRead<unknown[]>(LS_KEYS.columnOrder);
  const valid = Array.isArray(stored) ? stored.filter(isColId) : [];
  const seen = new Set(valid);
  const missing = VALID_COL_IDS.filter((id) => !seen.has(id));
  const result = [...valid, ...missing];
  return result.length === VALID_COL_IDS.length ? result : [...VALID_COL_IDS];
}

function loadSort(): { field: SortField | null; dir: "asc" | "desc" } {
  const s = lsRead<{ field: unknown; dir: unknown }>(LS_KEYS.sort);
  const field = s && isColId(s.field) ? s.field : null;
  const dir = s && (s.dir === "asc" || s.dir === "desc") ? s.dir : "asc";
  return { field, dir };
}

function getSortValue(inv: Invoice, field: SortField, lieferantenMap: Map<number, string>): string | number {
  switch (field) {
    case "dateiname":        return inv.dateiname ?? "";
    case "rechnungssteller": return inv.rechnungssteller ?? "";
    case "lieferant":        return inv.lieferantId ? (lieferantenMap.get(inv.lieferantId) ?? "") : "";
    case "datum":            return inv.datum ?? "";
    case "rnr":              return inv.rechnungsnummer ?? "";
    case "brutto":           return inv.bruttoBetrag ?? -Infinity;
    case "mwst":             return (typeof inv.steuersatz === "number" ? inv.steuersatz : parseFloat(String(inv.steuersatz ?? "")) || -Infinity);
    case "steuer":           return inv.steuerBetrag ?? -Infinity;
    case "netto":            return inv.nettoBetrag ?? -Infinity;
    case "waehrung":         return inv.waehrung ?? "";
    case "buchung":          return inv.buchungskonto1 ?? "";
    case "bemerkung":        return inv.bemerkung ?? "";
    case "freifeld1":        return inv.freifeld1 ?? "";
    case "freifeld2":        return inv.freifeld2 ?? "";
    case "freifeld3":        return inv.freifeld3 ?? "";
    default:                 return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk-edit dialog
// ─────────────────────────────────────────────────────────────────────────────
const MWST_PRESETS = [0, 7, 19];

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">
      {children}
    </Label>
  );
}

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
  const [steuersatz, setSteuersatz] = useState<string>("");
  const [freifeld1, setFreifeld1] = useState("");
  const [freifeld2, setFreifeld2] = useState("");
  const [freifeld3, setFreifeld3] = useState("");

  const resetAll = () => {
    setRechnungssteller(""); setLieferantId(""); setSteuersatz("");
    setFreifeld1(""); setFreifeld2(""); setFreifeld3("");
  };

  const bulkMutation = useBulkUpdateInvoices({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetInvoiceStatsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListLieferantenQueryKey() });
        onOpenChange(false);
        onDone();
        toast.success(`${selectedIds.length} Rechnung${selectedIds.length !== 1 ? "en" : ""} aktualisiert`);
      },
      onError: () => toast.error("Fehler beim Aktualisieren"),
    },
  });

  const handleSave = () => {
    const fields: Record<string, string | number | null> = {};
    if (rechnungssteller.trim()) fields.rechnungssteller = rechnungssteller.trim();
    if (lieferantId && lieferantId !== "none") fields.lieferantId = parseInt(lieferantId, 10);
    if (steuersatz.trim()) {
      const n = parseFloat(steuersatz.replace(",", "."));
      if (!isNaN(n)) fields.steuersatz = n;
    }
    if (freifeld1.trim()) fields.freifeld1 = freifeld1.trim();
    if (freifeld2.trim()) fields.freifeld2 = freifeld2.trim();
    if (freifeld3.trim()) fields.freifeld3 = freifeld3.trim();

    if (Object.keys(fields).length === 0) {
      toast.error("Bitte mindestens ein Feld ausfüllen");
      return;
    }
    bulkMutation.mutate({ data: { ids: selectedIds, fields } });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetAll(); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {selectedIds.length} Zeile{selectedIds.length !== 1 ? "n" : ""} bearbeiten
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground -mt-1">
          Nur ausgefüllte Felder werden übernommen — leere Felder bleiben unverändert.
        </p>

        <div className="space-y-4">
          {/* Rechnungssteller */}
          <div>
            <FieldLabel>Rechnungssteller</FieldLabel>
            <Input
              placeholder="Neuer Wert (leer = nicht ändern)"
              value={rechnungssteller}
              onChange={(e) => setRechnungssteller(e.target.value)}
            />
          </div>

          {/* Lieferant */}
          <div>
            <FieldLabel>Lieferant</FieldLabel>
            <Select value={lieferantId} onValueChange={setLieferantId}>
              <SelectTrigger>
                <SelectValue placeholder="— nicht ändern —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— nicht ändern —</SelectItem>
                {lieferanten.map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>
                    {l.name}{l.kuerzel ? ` (${l.kuerzel})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* MwSt % */}
          <div>
            <FieldLabel>MwSt %</FieldLabel>
            <div className="flex gap-1.5 items-center">
              {MWST_PRESETS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setSteuersatz(String(r))}
                  className={`px-2.5 py-1.5 text-xs rounded border transition-colors ${
                    steuersatz === String(r)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border bg-background hover:bg-muted text-foreground"
                  }`}
                >
                  {r} %
                </button>
              ))}
              <Input
                className="flex-1 h-8 text-sm"
                placeholder="oder freier Wert"
                value={steuersatz}
                onChange={(e) => setSteuersatz(e.target.value)}
                inputMode="decimal"
              />
            </div>
          </div>

          {/* Freifelder */}
          <div className="border-t border-border pt-3 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Freifelder</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <FieldLabel>Feld 1</FieldLabel>
                <Input
                  placeholder="leer = kein Ändern"
                  value={freifeld1}
                  onChange={(e) => setFreifeld1(e.target.value)}
                />
              </div>
              <div>
                <FieldLabel>Feld 2</FieldLabel>
                <Input
                  placeholder="leer = kein Ändern"
                  value={freifeld2}
                  onChange={(e) => setFreifeld2(e.target.value)}
                />
              </div>
              <div>
                <FieldLabel>Feld 3</FieldLabel>
                <Input
                  placeholder="leer = kein Ändern"
                  value={freifeld3}
                  onChange={(e) => setFreifeld3(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Abbrechen</Button>
          <Button onClick={handleSave} disabled={bulkMutation.isPending}>
            {bulkMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sortable header cell
// ─────────────────────────────────────────────────────────────────────────────
function SortHeader({
  colId,
  label,
  align,
  sortField,
  sortDir,
  onSort,
  className = "",
  ...thProps
}: {
  colId: ColId;
  label: string;
  align: "left" | "right";
  sortField: SortField | null;
  sortDir: "asc" | "desc";
  onSort: (id: ColId) => void;
  className?: string;
} & Omit<React.ComponentPropsWithoutRef<"th">, "className">) {
  const active = sortField === colId;
  return (
    <th
      className={`px-4 py-3 font-medium whitespace-nowrap ${align === "right" ? "text-right" : ""} ${className}`}
      {...thProps}
    >
      <button
        onClick={() => onSort(colId)}
        className={`flex items-center gap-1 hover:text-foreground transition-colors ${align === "right" ? "ml-auto" : ""}`}
      >
        {label}
        {active ? (
          sortDir === "asc"
            ? <ChevronUp className="h-3 w-3" />
            : <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
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

  // ── Column visibility ──────────────────────────────────────────────────────
  const [hiddenCols, setHiddenCols] = useState<Set<ColId>>(loadHiddenCols);
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const colMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    lsWrite(LS_KEYS.hiddenCols, [...hiddenCols]);
  }, [hiddenCols]);

  useEffect(() => {
    if (!colMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) {
        setColMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colMenuOpen]);

  const isVisible = (id: ColId) => !hiddenCols.has(id);

  const toggleCol = (id: ColId) =>
    setHiddenCols((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const visibleColCount = COLUMN_DEFS.filter((c) => isVisible(c.id)).length;
  const totalCols = 3 + visibleColCount; // link + checkbox + actions

  // ── Filter state ──────────────────────────────────────────────────────────
  const [searchText, setSearchText] = useState("");
  const [filterLieferantId, setFilterLieferantId] = useState<string>("all");
  const [filterDatumVon, setFilterDatumVon] = useState("");
  const [filterDatumBis, setFilterDatumBis] = useState("");

  // ── Column order (drag-to-reorder) ────────────────────────────────────────
  const [columnOrder, setColumnOrder] = useState<ColId[]>(loadColumnOrder);
  const [dragCol, setDragCol] = useState<ColId | null>(null);
  const [dragOver, setDragOver] = useState<ColId | null>(null);

  useEffect(() => {
    lsWrite(LS_KEYS.columnOrder, columnOrder);
  }, [columnOrder]);

  // ── Temporär ausgeblendete Zeilen (nur clientseitig, nicht gelöscht) ───────
  const [hiddenRows, setHiddenRows] = useState<Set<number>>(new Set());

  const handleColDrop = (targetId: ColId) => {
    if (!dragCol || dragCol === targetId) return;
    setColumnOrder((prev) => {
      const next = [...prev];
      const from = next.indexOf(dragCol);
      const to = next.indexOf(targetId);
      if (from === -1 || to === -1) return prev;
      next.splice(from, 1);
      next.splice(to, 0, dragCol);
      return next;
    });
    setDragCol(null);
    setDragOver(null);
  };

  // ordered list of currently visible columns
  const orderedVisibleCols = columnOrder.filter((id) => isVisible(id));

  // ── Sort state ────────────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<SortField | null>(() => loadSort().field);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => loadSort().dir);

  useEffect(() => {
    lsWrite(LS_KEYS.sort, { field: sortField, dir: sortDir });
  }, [sortField, sortDir]);

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
    if (hiddenRows.size > 0) list = list.filter((inv) => !hiddenRows.has(inv.id));
    if (sortField) {
      list = [...list].sort((a, b) => {
        const va = getSortValue(a, sortField, lieferantenMap);
        const vb = getSortValue(b, sortField, lieferantenMap);
        let cmp: number;
        if (typeof va === "number" && typeof vb === "number") {
          cmp = va - vb;
        } else {
          cmp = String(va).localeCompare(String(vb), "de");
        }
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return list;
  }, [invoices, searchText, filterLieferantId, filterDatumVon, filterDatumBis, hiddenRows, sortField, sortDir, lieferantenMap]);

  const hasActiveFilter = searchText || filterLieferantId !== "all" || filterDatumVon || filterDatumBis;
  const clearFilters = () => {
    setSearchText(""); setFilterLieferantId("all"); setFilterDatumVon(""); setFilterDatumBis("");
  };

  // ── Selection ─────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const allIds = useMemo(() => displayInvoices.map((i) => i.id), [displayInvoices]);
  const allChecked = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someChecked = selected.size > 0 && !allChecked;

  const toggle = (id: number) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(allIds));

  // ── Dialogs ───────────────────────────────────────────────────────────────
  const [lieferantenOpen, setLieferantenOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [buchungsOpen, setBuchungsOpen] = useState(false);
  const [buchungsInvoice, setBuchungsInvoice] = useState<Invoice | null>(null);
  const [detailInvoiceId, setDetailInvoiceId] = useState<number | null>(null);
  const detailInvoice = invoices?.find((i) => i.id === detailInvoiceId) ?? null;

  const openBulkBuchung = () => { setBuchungsInvoice(null); setBuchungsOpen(true); };
  const openSingleBuchung = (inv: Invoice) => { setBuchungsInvoice(inv); setBuchungsOpen(true); };

  // ── Mutations ─────────────────────────────────────────────────────────────
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
        toast.success(`Dropbox-Sync: ${data.imported} neu importiert, ${data.skipped} bereits vorhanden`);
      },
      onError: () => toast.error("Dropbox-Sync fehlgeschlagen"),
    },
  });

  const cleanupMutation = useTriggerDropboxCleanup({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetInvoiceStatsQueryKey() });
        if (data.removed === 0) {
          toast.success(`Bereinigung: Keine gelöschten Dateien gefunden (${data.checked} geprüft)`);
        } else {
          toast.success(`Bereinigung: ${data.removed} Einträge entfernt (${data.checked} geprüft)`);
        }
      },
      onError: () => toast.error("Dropbox-Bereinigung fehlgeschlagen"),
    },
  });

  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkReextractProgress, setBulkReextractProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

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
  const exportInvoices =
    selectedIds.length > 0
      ? invoices.filter((invoice) => selected.has(invoice.id))
      : invoices;

  const handleBulkReextract = async () => {
    const candidates = (
      selectedIds.length > 0
        ? invoices.filter((invoice) => selected.has(invoice.id))
        : invoices.filter((invoice) => (invoice.positionen?.length ?? 0) === 0)
    ).filter((invoice) => invoice.dropboxFileId);

    if (candidates.length === 0) {
      toast.info(
        selectedIds.length > 0
          ? "Keine der ausgewählten Rechnungen besitzt eine Dropbox-Datei."
          : "Alle Dropbox-Rechnungen enthalten bereits Positionen."
      );
      return;
    }

    setBulkReextractProgress({ done: 0, total: candidates.length });
    let succeeded = 0;
    let failed = 0;

    for (let index = 0; index < candidates.length; index += 1) {
      const invoice = candidates[index]!;
      try {
        const response = await fetch(`/api/invoices/${invoice.id}/reextract`, {
          method: "POST",
        });
        if (!response.ok) throw new Error(await response.text());
        const updated = (await response.json()) as Invoice;
        if ((updated.positionen?.length ?? 0) === 0) {
          throw new Error("Keine Rechnungspositionen erkannt");
        }
        succeeded += 1;
      } catch {
        failed += 1;
      } finally {
        setBulkReextractProgress({
          done: index + 1,
          total: candidates.length,
        });
      }
    }

    await queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
    await queryClient.invalidateQueries({
      queryKey: getGetInvoiceStatsQueryKey(),
    });
    setBulkReextractProgress(null);

    if (failed === 0) {
      toast.success(
        `${succeeded} Rechnung${succeeded !== 1 ? "en" : ""} mit Positionen aktualisiert`
      );
    } else {
      toast.warning(
        `${succeeded} aktualisiert, ${failed} fehlgeschlagen. Bitte Dropbox-Verbindung prüfen.`
      );
    }
  };

  const exportPositions = (format: "csv" | "xlsx") => {
    const count =
      format === "csv"
        ? exportInvoicePositionsToCSV(exportInvoices)
        : exportInvoicePositionsToXLSX(exportInvoices);
    if (count === 0) {
      toast.info(
        "Noch keine Rechnungspositionen vorhanden. Bitte die gewünschten Dropbox-Rechnungen zuerst neu auslesen."
      );
      return;
    }
    toast.success(
      `${count} Rechnungsposition${count !== 1 ? "en" : ""} exportiert`
    );
  };

  const sortHeaderProps = { sortField, sortDir, onSort: toggleSort };

  return (
    <>
      <div className="bg-card rounded-lg border border-border overflow-hidden flex flex-col shadow-sm">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-base font-semibold text-foreground">Erfasste Rechnungen</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => setLieferantenOpen(true)} title="Lieferantenverzeichnis">
              <Users className="h-4 w-4 mr-1" /> Lieferanten
            </Button>
            <Button
              variant="outline" size="sm"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending || cleanupMutation.isPending}
            >
              {syncMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Dropbox jetzt prüfen
            </Button>
            <Button
              variant="outline" size="sm"
              onClick={() => cleanupMutation.mutate()}
              disabled={cleanupMutation.isPending || syncMutation.isPending}
              title="Einträge entfernen, deren Datei in Dropbox gelöscht wurde"
            >
              {cleanupMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
              Gelöschte bereinigen
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportInvoicesToCSV(invoices)}>
              CSV Export
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportInvoicesToXLSX(invoices)}>
              Excel Export
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportPositions("csv")}>
              Positionen CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportPositions("xlsx")}>
              Positionen Excel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleBulkReextract}
              disabled={bulkReextractProgress !== null}
              title={
                selectedIds.length > 0
                  ? "Ausgewählte Rechnungen neu auslesen"
                  : "Bestehende Dropbox-Rechnungen ohne Positionen nachholen"
              }
            >
              {bulkReextractProgress ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-1" />
              )}
              {bulkReextractProgress
                ? `Positionen ${bulkReextractProgress.done}/${bulkReextractProgress.total}`
                : "Positionen nachholen"}
            </Button>

            {/* ── Column picker ─────────────────────────────────────────── */}
            <div className="relative" ref={colMenuRef}>
              <Button
                variant={hiddenCols.size > 0 ? "default" : "outline"}
                size="sm"
                onClick={() => setColMenuOpen((o) => !o)}
                title="Spalten ein-/ausblenden"
              >
                <Columns className="h-4 w-4 mr-1" />
                Spalten
                {hiddenCols.size > 0 && (
                  <span className="ml-1 bg-white/20 text-xs rounded px-1">{COLUMN_DEFS.length - hiddenCols.size}/{COLUMN_DEFS.length}</span>
                )}
              </Button>

              {colMenuOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-lg p-2 w-56">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 pb-1.5 border-b border-border mb-1">
                    Spalten — Reihenfolge per Drag &amp; Drop im Tabellenkopf ändern
                  </p>
                  <div className="space-y-0.5 max-h-80 overflow-y-auto">
                    {columnOrder.map((colId) => {
                      const col = COLUMN_DEFS.find((c) => c.id === colId)!;
                      const visible = isVisible(colId);
                      return (
                        <button
                          key={colId}
                          onClick={() => toggleCol(colId)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-muted transition-colors text-left"
                        >
                          <span className={`h-4 w-4 flex items-center justify-center rounded border shrink-0 transition-colors ${visible ? "bg-primary border-primary" : "border-border"}`}>
                            {visible && <Check className="h-3 w-3 text-white" />}
                          </span>
                          {col.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="border-t border-border mt-1 pt-1 flex flex-col gap-0.5">
                    {hiddenCols.size > 0 && (
                      <button
                        onClick={() => setHiddenCols(new Set())}
                        className="w-full text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors text-left"
                      >
                        Alle einblenden
                      </button>
                    )}
                    <button
                      onClick={() => setColumnOrder(COLUMN_DEFS.map((c) => c.id))}
                      className="w-full text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors text-left"
                    >
                      Reihenfolge zurücksetzen
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Filter Bar ──────────────────────────────────────────────────── */}
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

        {/* ── Bulk Action Bar ──────────────────────────────────────────────── */}
        {selected.size > 0 && (
          <div className="px-4 py-2 bg-primary/5 border-b border-primary/20 flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-primary">{selected.size} ausgewählt</span>
            <Button size="sm" variant="outline" onClick={() => setBulkEditOpen(true)}>
              <Users className="h-3.5 w-3.5 mr-1" /> Rechnungssteller / Lieferant setzen
            </Button>
            <Button size="sm" variant="outline" onClick={openBulkBuchung}>
              <BookOpen className="h-3.5 w-3.5 mr-1" /> Buchen
            </Button>
            <Button
              size="sm" variant="outline"
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
              <Sparkles className="h-3.5 w-3.5 mr-1" /> Neu extrahieren (KI)
            </Button>
            <Button
              size="sm" variant="outline"
              onClick={() => {
                const count = selected.size;
                setHiddenRows((prev) => {
                  const next = new Set(prev);
                  selected.forEach((id) => next.add(id));
                  return next;
                });
                setSelected(new Set());
                toast.success(`${count} Zeile${count !== 1 ? "n" : ""} ausgeblendet`);
              }}
            >
              <EyeOff className="h-3.5 w-3.5 mr-1" /> Ausblenden
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setBulkDeleteConfirmOpen(true)} disabled={isBulkDeleting}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Löschen
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              <X className="h-3.5 w-3.5 mr-1" /> Auswahl aufheben
            </Button>
          </div>
        )}

        {/* ── Hidden Rows Bar ──────────────────────────────────────────────── */}
        {hiddenRows.size > 0 && (
          <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-3 flex-wrap">
            <EyeOff className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-sm text-amber-700 dark:text-amber-400">
              {hiddenRows.size} Zeile{hiddenRows.size !== 1 ? "n" : ""} ausgeblendet
            </span>
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => setHiddenRows(new Set())}>
              <Eye className="h-3.5 w-3.5 mr-1" /> Alle wieder einblenden
            </Button>
          </div>
        )}

        {/* ── Table ────────────────────────────────────────────────────────── */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground bg-muted/30 border-b border-border">
              <tr>
                <th className="px-3 py-3 w-8 text-center"></th>
                <th className="px-3 py-3 w-10">
                  <Checkbox
                    checked={allChecked}
                    data-state={someChecked ? "indeterminate" : allChecked ? "checked" : "unchecked"}
                    onCheckedChange={toggleAll}
                    aria-label="Alle auswählen"
                  />
                </th>

                {orderedVisibleCols.map((colId) => {
                  const col = COLUMN_DEFS.find((c) => c.id === colId)!;
                  const isDragOver = dragOver === colId;
                  const isDragging = dragCol === colId;
                  const dragHandlers = {
                    draggable: true as const,
                    onDragStart: (e: React.DragEvent) => {
                      e.dataTransfer.effectAllowed = "move";
                      setDragCol(colId);
                    },
                    onDragOver: (e: React.DragEvent) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (dragOver !== colId) setDragOver(colId);
                    },
                    onDrop: (e: React.DragEvent) => {
                      e.preventDefault();
                      handleColDrop(colId);
                    },
                    onDragEnd: () => { setDragCol(null); setDragOver(null); },
                  };
                  const dragCls = isDragOver
                    ? "border-l-2 border-l-primary bg-primary/5"
                    : isDragging
                    ? "opacity-40"
                    : "";

                  if (colId === "buchung") {
                    return (
                      <th
                        key={colId}
                        {...dragHandlers}
                        className={`px-4 py-3 font-medium whitespace-nowrap cursor-grab select-none ${dragCls}`}
                        title="Ziehen zum Verschieben"
                      >
                        Buchung
                      </th>
                    );
                  }
                  return (
                    <SortHeader
                      key={colId}
                      colId={colId as SortField}
                      label={col.label}
                      align={col.align}
                      {...sortHeaderProps}
                      className={`cursor-grab select-none ${dragCls}`}
                      title="Ziehen zum Verschieben"
                      {...dragHandlers}
                    />
                  );
                })}

                <th className="px-4 py-3 font-medium text-center w-12">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {displayInvoices.length === 0 && (
                <tr>
                  <td colSpan={totalCols} className="px-4 py-8 text-center text-sm text-muted-foreground">
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

                    {orderedVisibleCols.map((colId) => {
                      switch (colId) {
                        case "dateiname":
                          return (
                            <td key="dateiname" className="px-4 py-2 text-xs truncate max-w-[120px] text-muted-foreground" title={inv.dateiname ?? ""}>
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
                          );
                        case "rechnungssteller":
                          return (
                            <td key="rechnungssteller" className="px-4 py-2 font-medium">
                              <EditableCell value={inv.rechnungssteller} onSave={(v) => handleUpdate(inv.id, "rechnungssteller", v)} />
                            </td>
                          );
                        case "lieferant":
                          return (
                            <td key="lieferant" className="px-4 py-2">
                              {lieferantName ? (
                                <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-medium">{lieferantName}</span>
                              ) : (
                                <span className="text-xs text-muted-foreground/40 italic">—</span>
                              )}
                            </td>
                          );
                        case "datum":
                          return (
                            <td key="datum" className="px-4 py-2">
                              <EditableCell type="date" value={inv.datum} onSave={(v) => handleUpdate(inv.id, "datum", v)} className="font-mono text-xs" />
                            </td>
                          );
                        case "rnr":
                          return (
                            <td key="rnr" className="px-4 py-2">
                              <EditableCell value={inv.rechnungsnummer} onSave={(v) => handleUpdate(inv.id, "rechnungsnummer", v)} />
                            </td>
                          );
                        case "brutto":
                          return (
                            <td key="brutto" className="px-4 py-2 text-right">
                              <EditableCell type="number" value={inv.bruttoBetrag != null ? formatNumber(inv.bruttoBetrag) : null} onSave={(v) => handleUpdate(inv.id, "bruttoBetrag", v)} className="font-mono text-right" />
                            </td>
                          );
                        case "mwst":
                          return (
                            <td key="mwst" className="px-4 py-2 text-right">
                              <EditableCell type="number" value={inv.steuersatz} onSave={(v) => handleUpdate(inv.id, "steuersatz", v)} className="font-mono text-right" />
                            </td>
                          );
                        case "steuer":
                          return (
                            <td key="steuer" className="px-4 py-2 text-right">
                              <EditableCell type="number" value={inv.steuerBetrag != null ? formatNumber(inv.steuerBetrag) : null} onSave={(v) => handleUpdate(inv.id, "steuerBetrag", v)} className="font-mono text-right text-muted-foreground" />
                            </td>
                          );
                        case "netto":
                          return (
                            <td key="netto" className="px-4 py-2 text-right">
                              <EditableCell type="number" value={inv.nettoBetrag != null ? formatNumber(inv.nettoBetrag) : null} onSave={(v) => handleUpdate(inv.id, "nettoBetrag", v)} className="font-mono text-right" />
                            </td>
                          );
                        case "waehrung":
                          return (
                            <td key="waehrung" className="px-4 py-2">
                              <EditableCell value={inv.waehrung} onSave={(v) => handleUpdate(inv.id, "waehrung", v)} />
                            </td>
                          );
                        case "buchung":
                          return (
                            <td key="buchung" className="px-4 py-2">
                              <button
                                onClick={() => openSingleBuchung(inv)}
                                className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${
                                  hasBuchung
                                    ? "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400"
                                    : "border-border text-muted-foreground/50 hover:border-primary/50 hover:text-primary"
                                }`}
                                title={hasBuchung ? `${inv.buchungskonto1 ?? ""}${inv.buchungskonto2 ? " / " + inv.buchungskonto2 : ""}` : "Buchung erfassen"}
                              >
                                {hasBuchung ? `${inv.buchungskonto1 ?? "?"}${inv.buchungskonto2 ? "/" + inv.buchungskonto2 : ""}` : "— buchen"}
                              </button>
                            </td>
                          );
                        case "bemerkung":
                          return (
                            <td key="bemerkung" className="px-4 py-2">
                              <EditableCell value={inv.bemerkung} onSave={(v) => handleUpdate(inv.id, "bemerkung", v)} />
                            </td>
                          );
                        case "freifeld1":
                          return (
                            <td key="freifeld1" className="px-4 py-2">
                              <EditableCell value={inv.freifeld1 ?? null} onSave={(v) => handleUpdate(inv.id, "freifeld1", v)} />
                            </td>
                          );
                        case "freifeld2":
                          return (
                            <td key="freifeld2" className="px-4 py-2">
                              <EditableCell value={inv.freifeld2 ?? null} onSave={(v) => handleUpdate(inv.id, "freifeld2", v)} />
                            </td>
                          );
                        case "freifeld3":
                          return (
                            <td key="freifeld3" className="px-4 py-2">
                              <EditableCell value={inv.freifeld3 ?? null} onSave={(v) => handleUpdate(inv.id, "freifeld3", v)} />
                            </td>
                          );
                        default:
                          return null;
                      }
                    })}

                    <td className="px-4 py-2 text-center">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost" size="icon"
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
                              {inv.rechnungssteller || inv.dateiname} wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.
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
              Diese Aktion löscht {selectedIds.length === 1 ? "die ausgewählte Rechnung" : `alle ${selectedIds.length} ausgewählten Rechnungen`} unwiderruflich.
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
        hiddenCols={hiddenCols}
      />

      {/* Other Dialogs */}
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
