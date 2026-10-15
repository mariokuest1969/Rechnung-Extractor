import { useEffect, useMemo, useState } from "react";
import type { Invoice } from "@workspace/api-client-react";
import { createArticleSummary, type ArticleScope } from "@/lib/article-summary";
import { createArticleExportTable, type ArticleView } from "@/lib/article-summary-export";
import { exportArticleSummaryToCSV } from "@/lib/csv";
import { exportArticleSummaryToXLSX } from "@/lib/xlsx-export";
import { sortArticleGroups, sortArticleRows, type ArticleSort, type ArticleSortKey } from "@/lib/article-sort";
import { formatDate } from "@/lib/format";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Download, Info, Layers, ListOrdered } from "lucide-react";

const num = (v: number | null | undefined, digits = 2) =>
  typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: digits })
    : "—";
const money = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";
const pct = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? `${num(v)} %` : "—");
const text = (v: string | null | undefined) => (v && v.trim() ? v : "—");

function Partial({ value, missing, total }: { value: string; missing: number; total: number }) {
  if (missing === 0) return <>{value}</>;
  return (
    <span className="inline-flex flex-col items-end">
      <span className={value === "—" ? "" : "text-amber-700 dark:text-amber-400"}>{value}</span>
      <span className="text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400"
        title={`${missing} von ${total} Positionen ohne Wert`}>
        {value === "—" ? "fehlt" : `unvollständig, ${missing}/${total} fehlen`}
      </span>
    </span>
  );
}

const th = "px-3 py-2 font-medium whitespace-nowrap text-left";
const thR = "px-3 py-2 font-medium whitespace-nowrap text-right";
const td = "px-3 py-2 align-top";
const tdR = "px-3 py-2 align-top text-right tabular-nums whitespace-nowrap";

export function ArticleSummaryDialog({
  open, onOpenChange, invoices, selectedIds, supplierNames,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  invoices: readonly Invoice[];
  selectedIds: readonly number[];
  supplierNames: ReadonlyMap<number, string>;
}) {
  const [scope, setScope] = useState<ArticleScope>("period");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [view, setView] = useState<ArticleView>("grouped");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [groupSort, setGroupSort] = useState<ArticleSort>({ key: "description", direction: "asc" });
  const [rowSort, setRowSort] = useState<ArticleSort>({ key: "description", direction: "asc" });

  useEffect(() => {
    if (open) setScope(selectedIds.length > 0 ? "selected" : "period");
    // only on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const unsortedSummary = useMemo(
    () => createArticleSummary(invoices, { scope, selectedIds, from, to }, supplierNames),
    [invoices, scope, selectedIds, from, to, supplierNames],
  );
  const summary = useMemo(() => ({
    ...unsortedSummary,
    groups: sortArticleGroups(unsortedSummary.groups, groupSort),
    rows: sortArticleRows(unsortedSummary.rows, rowSort),
  }), [unsortedSummary, groupSort, rowSort]);
  const heading = (label: string, key: ArticleSortKey, right = false) => {
    const sort = view === "grouped" ? groupSort : rowSort;
    const active = sort.key === key;
    return (
      <th className={right ? thR : th} aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" className="inline-flex items-center gap-1 rounded focus-visible:outline focus-visible:outline-2"
          title={`${label} ${active && sort.direction === "asc" ? "absteigend" : "aufsteigend"} sortieren`}
          onClick={() => (view === "grouped" ? setGroupSort : setRowSort)({
            key, direction: active && sort.direction === "asc" ? "desc" : "asc",
          })}>
          {label}<span aria-hidden="true">{active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span>
        </button>
      </th>
    );
  };

  const noMarked = scope === "selected" && selectedIds.length === 0;
  const empty = !summary.invalidRange && !noMarked && summary.rows.length === 0;
  const exportDisabled = summary.invalidRange || noMarked || empty || exporting;
  const download = async (format: "csv" | "xlsx") => {
    if (exportDisabled) return;
    setExportError("");
    setExporting(true);
    try {
      const table = createArticleExportTable(summary, view);
      if (format === "csv") exportArticleSummaryToCSV(table, view);
      else await exportArticleSummaryToXLSX(table, view);
    } catch {
      setExportError("Der Export konnte nicht erstellt werden. Bitte erneut versuchen.");
    } finally {
      setExporting(false);
    }
  };
  const seg = (active: boolean) =>
    `px-3 py-1.5 text-xs rounded-md transition-colors inline-flex items-center gap-1.5 ${
      active ? "bg-background text-foreground shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl w-[calc(100vw-1.5rem)] max-h-[92dvh] overflow-y-auto flex flex-col gap-3 p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Artikelübersicht</DialogTitle>
          <DialogDescription>
            Auswertung der bereits erfassten Rechnungspositionen. Es wird nichts neu ausgelesen.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Umfang</span>
            <div role="radiogroup" aria-label="Umfang" className="inline-flex rounded-lg bg-muted p-1">
              <button type="button" role="radio" aria-checked={scope === "period"} className={seg(scope === "period")}
                onClick={() => setScope("period")} data-testid="button-scope-period">Zeitraum</button>
              <button type="button" role="radio" aria-checked={scope === "selected"} className={seg(scope === "selected")}
                onClick={() => setScope("selected")} data-testid="button-scope-selected">
                Markierte Rechnungen ({selectedIds.length})
              </button>
            </div>
          </div>
          {scope === "period" && (
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end">
              <div>
                <Label htmlFor="art-von" className="text-xs text-muted-foreground">Von (Rechnungsdatum)</Label>
                <Input id="art-von" type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                  className="h-8 text-sm" aria-invalid={summary.invalidRange} data-testid="input-article-from" />
              </div>
              <div>
                <Label htmlFor="art-bis" className="text-xs text-muted-foreground">Bis (einschließlich)</Label>
                <Input id="art-bis" type="date" value={to} onChange={(e) => setTo(e.target.value)}
                  className="h-8 text-sm" aria-invalid={summary.invalidRange} data-testid="input-article-to" />
              </div>
              {(from || to) && (
                <Button variant="ghost" size="sm" className="col-span-2 sm:col-span-1 h-8"
                  onClick={() => { setFrom(""); setTo(""); }} data-testid="button-article-clear-dates">
                  Alle Daten
                </Button>
              )}
            </div>
          )}
          {scope === "period" && (from || to) && summary.undatedCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {summary.undatedCount} Rechnung{summary.undatedCount !== 1 ? "en" : ""} ohne Datum
              {summary.undatedCount !== 1 ? " sind" : " ist"} bei begrenztem Zeitraum nicht enthalten.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="tablist" aria-label="Ansicht" className="inline-flex rounded-lg bg-muted p-1">
            <button type="button" role="tab" aria-selected={view === "grouped"} className={seg(view === "grouped")}
              onClick={() => setView("grouped")} data-testid="tab-article-grouped">
              <Layers className="h-3.5 w-3.5" /> Gleiche Artikel
            </button>
            <button type="button" role="tab" aria-selected={view === "rows"} className={seg(view === "rows")}
              onClick={() => setView("rows")} data-testid="tab-article-rows">
              <ListOrdered className="h-3.5 w-3.5" /> Einzelpositionen
            </button>
          </div>
          {!summary.invalidRange && !noMarked && (
            <p className="text-xs text-muted-foreground tabular-nums" data-testid="text-article-counts" aria-live="polite">
              {summary.invoiceCount} Rechnung{summary.invoiceCount !== 1 ? "en" : ""} · {summary.rows.length} Positionen
              · {summary.groups.length} Gruppen
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={exportDisabled}
            onClick={() => void download("csv")} data-testid="button-article-export-csv">
            <Download className="mr-1.5 h-3.5 w-3.5" /> CSV herunterladen
          </Button>
          <Button variant="outline" size="sm" disabled={exportDisabled}
            onClick={() => void download("xlsx")} data-testid="button-article-export-xlsx">
            <Download className="mr-1.5 h-3.5 w-3.5" /> Excel herunterladen
          </Button>
          <span className="text-xs text-muted-foreground" role="status">
            {exporting ? "Export wird erstellt …" : "Exportiert die aktuelle Ansicht und den gewählten Umfang."}
          </span>
        </div>
        {exportError && <p role="alert" className="text-sm text-destructive">{exportError}</p>}

        {view === "grouped" && !summary.invalidRange && !noMarked && !empty && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            Gleiche Artikel werden getrennt nach Lieferant, Einheit, Währung und Steuersatz zusammengefasst.
            Währungen werden nie gemischt; fehlende Werte werden nicht geschätzt.
          </p>
        )}
        {!summary.invalidRange && !noMarked && summary.missingPositionsCount > 0 && (
          <p className="flex items-start gap-1.5 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
            data-testid="text-missing-positions">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            {summary.missingPositionsCount} von {summary.invoiceCount} Rechnungen im Umfang
            {summary.missingPositionsCount !== 1 ? " haben" : " hat"} keine erfassten Positionen und
            {summary.missingPositionsCount !== 1 ? " fehlen" : " fehlt"} daher in der Übersicht.
          </p>
        )}

        <div className="min-h-[160px] flex-1 overflow-auto rounded-lg border border-border">
          {summary.invalidRange ? (
            <div role="alert" className="p-8 text-center" data-testid="error-article-range">
              <p className="font-medium text-destructive">Ungültiger Zeitraum</p>
              <p className="mt-1 text-sm text-muted-foreground">Das Von-Datum liegt nach dem Bis-Datum. Bitte Zeitraum korrigieren.</p>
            </div>
          ) : noMarked ? (
            <div className="p-8 text-center" data-testid="empty-article-selected">
              <p className="font-medium text-foreground">Keine Rechnungen markiert</p>
              <p className="mt-1 text-sm text-muted-foreground">Markieren Sie Rechnungen in der Tabelle oder wählen Sie einen Zeitraum.</p>
            </div>
          ) : empty ? (
            <div className="p-8 text-center" data-testid="empty-article">
              <p className="font-medium text-foreground">Keine Positionen gefunden</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {summary.invoiceCount === 0 ? "Im gewählten Umfang liegen keine Rechnungen." : "Für diese Rechnungen wurden keine Artikelpositionen erfasst."}
              </p>
            </div>
          ) : view === "grouped" ? (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/90 backdrop-blur text-xs text-muted-foreground">
                <tr>
                  {heading("Artikel", "description")}{heading("Lieferant", "supplier")}{heading("Einheit", "unit")}
                  {heading("Menge", "quantity", true)}{heading("Netto", "net", true)}{heading("Brutto", "gross", true)}
                  {heading("Währung", "currency")}{heading("MwSt", "taxRate", true)}{heading("Rechnungen", "invoiceCount", true)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {summary.groups.map((g, i) => (
                  <tr key={g.key} className="hover:bg-muted/30" data-testid={`row-article-group-${i}`}>
                    <td className={`${td} min-w-[180px] font-medium`}>{g.description}
                      {g.positionCount > 1 && <span className="block text-[11px] font-normal text-muted-foreground">{g.positionCount} Positionen</span>}
                    </td>
                    <td className={`${td} min-w-[120px]`}>{g.supplier}</td>
                    <td className={td}>{g.unit}</td>
                    <td className={tdR}><Partial value={num(g.quantity, 3)} missing={g.missingQuantity} total={g.positionCount} /></td>
                    <td className={tdR}><Partial value={money(g.net)} missing={g.missingNet} total={g.positionCount} /></td>
                    <td className={tdR}><Partial value={money(g.gross)} missing={g.missingGross} total={g.positionCount} /></td>
                    <td className={td}>{g.currency}</td>
                    <td className={tdR}>{pct(g.taxRate)}</td>
                    <td className={tdR}>{g.invoiceCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/90 backdrop-blur text-xs text-muted-foreground">
                <tr>
                  {heading("Artikel", "description")}{heading("Lieferant", "supplier")}{heading("Datum", "date")}
                  {heading("RNR", "invoiceNumber")}{heading("Menge", "quantity", true)}{heading("Einheit", "unit")}
                  {heading("Einzelpreis", "unitPrice", true)}{heading("Netto", "net", true)}{heading("Brutto", "gross", true)}
                  {heading("Währung", "currency")}{heading("MwSt", "taxRate", true)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {summary.rows.map((r, i) => (
                  <tr key={`${r.invoiceId}-${i}`} className="hover:bg-muted/30" data-testid={`row-article-position-${i}`}>
                    <td className={`${td} min-w-[180px]`}>{text(r.position.beschreibung)}</td>
                    <td className={`${td} min-w-[120px]`}>{r.supplier}</td>
                    <td className={`${td} whitespace-nowrap`}>{r.date ? formatDate(r.date) : "—"}</td>
                    <td className={`${td} whitespace-nowrap`}>{r.invoiceNumber}</td>
                    <td className={tdR}>{num(r.position.menge, 3)}</td>
                    <td className={td}>{text(r.position.einheit)}</td>
                    <td className={tdR}>{money(r.position.einzelpreis)}</td>
                    <td className={tdR}>{money(r.position.nettobetrag)}</td>
                    <td className={tdR}>{money(r.position.bruttobetrag)}</td>
                    <td className={td}>{r.currency}</td>
                    <td className={tdR}>{pct(r.position.steuersatz)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
