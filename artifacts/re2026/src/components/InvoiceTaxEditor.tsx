import { useEffect, useState, type ReactNode } from "react";
import type { Invoice, InvoiceUpdate } from "@workspace/api-client-react";
import { calculateTaxSplit, SPLIT_NET_FIELDS, type SplitNets } from "@workspace/invoice-tax";
import { validateSingleNumber } from "@/lib/single-edit-validation";
import { formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";

export function InvoiceTaxEditor({ invoice, onSave, children }: {
  invoice: Invoice;
  onSave: (data: InvoiceUpdate) => Promise<unknown>;
  children: ReactNode;
}) {
  const [mode, setMode] = useState(invoice.steuerModus ?? "single");
  const [draft, setDraft] = useState({ netto7: "", netto19: "", netto0: "" });
  const [pending, setPending] = useState(false);
  const [serverError, setServerError] = useState<string>();
  useEffect(() => {
    setMode(invoice.steuerModus ?? "single");
    setDraft(Object.fromEntries(SPLIT_NET_FIELDS.map(key =>
      [key, invoice[key] == null ? "" : String(invoice[key])])) as typeof draft);
    setServerError(undefined);
  }, [invoice.id, invoice.steuerModus, invoice.netto7, invoice.netto19, invoice.netto0]);

  let calculated: ReturnType<typeof calculateTaxSplit> | undefined;
  let validationError: string | undefined;
  const nets = {} as SplitNets;
  if (mode === "split") {
    for (const key of SPLIT_NET_FIELDS) {
      const parsed = validateSingleNumber("buchungskonto1Betrag", draft[key]);
      nets[key] = parsed.value;
      if (parsed.error && !validationError) validationError = `${key === "netto7" ? "Netto 7 %" : key === "netto19" ? "Netto 19 %" : "Netto 0 %"}: ${parsed.error}`;
    }
    if (!validationError) {
      try { calculated = calculateTaxSplit(nets); }
      catch (error) { validationError = (error as Error).message; }
    }
  }
  const save = async () => {
    if (pending || validationError) return;
    setPending(true);
    setServerError(undefined);
    try {
      await onSave(mode === "split" ? { steuerModus: "split", ...nets } : { steuerModus: "single" });
    } catch (error) {
      const message = (error as { data?: { error?: string } })?.data?.error;
      setServerError(message ?? "Nicht gespeichert. Ihre Eingaben bleiben erhalten. Bitte erneut versuchen.");
    } finally { setPending(false); }
  };
  const money = (value: number | null | undefined) => value == null ? "—" : formatNumber(value);
  return <section aria-label="Rechnungsbeträge" className="space-y-3">
    <fieldset disabled={pending} className="space-y-3">
      <label className="text-xs font-medium text-muted-foreground flex flex-col gap-1">
        Steuerberechnung
        <select aria-label="Steuerberechnung" className="border rounded px-2 py-1 text-sm bg-background"
          value={mode} onChange={event => { setMode(event.target.value as typeof mode); setServerError(undefined); }}>
          <option value="single">Einzelsteuersatz (bisherige Werte)</option>
          <option value="split">Nettoaufteilung 7 / 19 / 0 %</option>
        </select>
      </label>
      {mode === "split" ? <>
        <p className="text-xs text-muted-foreground">Netto je Steuersatz eingeben. Leer = nicht angegeben; 0 = ausdrücklich null Euro. Bestehende Summen werden nicht aufgeteilt.</p>
        <div className="grid grid-cols-3 gap-2">
          {SPLIT_NET_FIELDS.map((key, index) => <label key={key} className="text-xs font-medium">
            Netto {[7, 19, 0][index]} %
            <input aria-label={`Netto ${[7, 19, 0][index]} %`} inputMode="decimal" type="text"
              className="border rounded px-2 py-1 text-sm bg-background w-full mt-1" value={draft[key]}
              onChange={event => { setDraft(prev => ({ ...prev, [key]: event.target.value })); setServerError(undefined); }} />
          </label>)}
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs" aria-label="Berechnete Beträge">
          <dt>Steuer 7 %</dt><dd>{money(calculated?.steuer7)}</dd>
          <dt>Steuer 19 %</dt><dd>{money(calculated?.steuer19)}</dd>
          <dt>Steuer 0 %</dt><dd>{money(calculated?.steuer0)}</dd>
          <dt>Gesamtnetto</dt><dd>{money(calculated?.nettoBetrag)}</dd>
          <dt>Gesamtsteuer</dt><dd>{money(calculated?.steuerBetrag)}</dd>
          <dt className="font-semibold">Gesamtbrutto</dt><dd className="font-semibold">{money(calculated?.bruttoBetrag)}</dd>
        </dl>
        <p className="text-xs text-muted-foreground">Steuer wird je Satz auf Cent gerundet, bei Gutschriften entsprechend negativ. Summen und Aufteilung werden gemeinsam gespeichert.</p>
      </> : invoice.steuerModus === "split" ?
        <p className="text-xs text-muted-foreground">Beim Speichern wird die Aufteilung entfernt. Die bisherigen Summen bleiben erhalten; ein Einzelsteuersatz wird nicht aus gemischten Beträgen abgeleitet.</p>
        : children}
      {validationError && <p role="alert" className="text-xs text-destructive">{validationError}</p>}
      {serverError && <p role="alert" className="text-xs text-destructive">{serverError}</p>}
      {(mode === "split" || invoice.steuerModus === "split") &&
        <Button type="button" size="sm" disabled={pending || !!validationError} onClick={() => void save()}>
          {pending ? "Wird gespeichert…" : mode === "split" ? "Steueraufteilung speichern" : "Zu Einzelsteuer wechseln"}
        </Button>}
    </fieldset>
  </section>;
}
