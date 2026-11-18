import { useListLieferanten, useListBuchungskonten } from "@workspace/api-client-react";
import { calculateTaxSplit } from "@workspace/invoice-tax";
import { InvoiceStatusSelect } from "./InvoiceStatusSelect";
import { formatNumber } from "@/lib/format";
import { validateSingleNumber } from "@/lib/single-edit-validation";
import { splitGross, type BookingDraft, type DraftErrors } from "@/lib/manual-booking";

const inputCls = "border border-border rounded px-2 py-1.5 text-sm bg-background w-full focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-60";

function F({ label, error, children, className = "" }: { label: string; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 text-xs font-medium text-muted-foreground ${className}`}>
      {label}
      {children}
      {error && <span role="alert" className="text-destructive font-normal">{error}</span>}
    </label>
  );
}

export function BookingFields({ draft, onChange, errors, disabled = false, showStatus, showDate = true, idPrefix }: {
  draft: BookingDraft;
  onChange: (patch: Partial<BookingDraft>) => void;
  errors: DraftErrors;
  disabled?: boolean;
  showStatus: boolean;
  showDate?: boolean;
  idPrefix: string;
}) {
  const { data: lieferanten = [] } = useListLieferanten();
  const { data: konten = [] } = useListBuchungskonten();
  const listId = `${idPrefix}-konten`;
  const text = (key: keyof BookingDraft, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input className={inputCls} value={draft[key] as string} disabled={disabled}
      data-testid={`input-${idPrefix}-${key}`} aria-invalid={!!errors[key]}
      onChange={(e) => onChange({ [key]: e.target.value } as Partial<BookingDraft>)} {...extra} />
  );

  let preview: { netto: number | null; steuer: number | null; brutto: number | null } | null = null;
  if (draft.steuerModus === "split") {
    const nets = { netto7: validateSingleNumber("buchungskonto1Betrag", draft.netto7), netto19: validateSingleNumber("buchungskonto1Betrag", draft.netto19), netto0: validateSingleNumber("buchungskonto1Betrag", draft.netto0) };
    if (!nets.netto7.error && !nets.netto19.error && !nets.netto0.error) {
      try {
        const r = calculateTaxSplit({ netto7: nets.netto7.value, netto19: nets.netto19.value, netto0: nets.netto0.value });
        preview = { netto: r.nettoBetrag, steuer: r.steuerBetrag, brutto: r.bruttoBetrag };
      } catch { preview = null; }
    }
  } else {
    const b = validateSingleNumber("buchungskonto1Betrag", draft.bruttoBetrag);
    const r = validateSingleNumber("steuersatz", draft.steuersatz);
    if (!b.error && !r.error && b.value != null && r.value != null) {
      const sp = splitGross(b.value, r.value);
      preview = { netto: sp.nettoBetrag, steuer: sp.steuerBetrag, brutto: b.value };
    }
  }

  return (
    <fieldset disabled={disabled} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {showDate && <F label="Datum *" error={errors.datum}>{text("datum", { type: "date" })}</F>}
        <F label="Währung *" error={errors.waehrung}>{text("waehrung", { maxLength: 3, placeholder: "EUR" })}</F>
        {showStatus ? (
          <F label="Bearbeitungsstatus">
            <InvoiceStatusSelect value={draft.bearbeitungsstatus} disabled={disabled}
              onChange={(v) => { if (v) onChange({ bearbeitungsstatus: v }); }} />
          </F>
        ) : (
          <div className="text-xs text-muted-foreground self-end pb-1.5">Bestätigte Termine werden immer als <strong>nicht geprüft</strong> angelegt.</div>
        )}
      </div>
      <F label="Buchungstext *" error={errors.buchungstext}>{text("buchungstext", { maxLength: 2000, placeholder: "z. B. Miete Büro Lindenstraße" })}</F>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <F label="Rechnungssteller / Empfänger">{text("rechnungssteller")}</F>
        <F label="Belegnummer">{text("rechnungsnummer")}</F>
        <F label="Lieferant">
          <select className={inputCls} value={draft.lieferantId} data-testid={`select-${idPrefix}-lieferant`}
            onChange={(e) => onChange({ lieferantId: e.target.value })}>
            <option value="">— keiner —</option>
            {lieferanten.map((l) => <option key={l.id} value={String(l.id)}>{l.name}{l.kuerzel ? ` (${l.kuerzel})` : ""}</option>)}
          </select>
        </F>
      </div>

      <div className="rounded-md border border-border p-3 space-y-3 bg-muted/20">
        <div className="flex items-center gap-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Beträge
          <div className="flex rounded border border-border overflow-hidden normal-case tracking-normal font-medium">
            {(["single", "split"] as const).map((m) => (
              <button key={m} type="button" data-testid={`toggle-${idPrefix}-tax-${m}`}
                onClick={() => onChange({ steuerModus: m })}
                className={`px-2.5 py-1 ${draft.steuerModus === m ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
                {m === "single" ? "Brutto + Steuersatz" : "Netto 7 / 19 / 0 %"}
              </button>
            ))}
          </div>
        </div>
        {draft.steuerModus === "single" ? (
          <div className="grid grid-cols-2 gap-3">
            <F label="Brutto *" error={errors.bruttoBetrag}>{text("bruttoBetrag", { inputMode: "decimal", placeholder: "-123,45" })}</F>
            <F label="MwSt % *" error={errors.steuersatz}>
              <div className="flex gap-1">
                {[19, 7, 0].map((r) => (
                  <button key={r} type="button" onClick={() => onChange({ steuersatz: String(r) })}
                    className={`px-2 rounded border text-xs ${draft.steuersatz === String(r) ? "bg-primary text-primary-foreground border-primary" : "border-border bg-background hover:bg-muted"}`}>{r}</button>
                ))}
                {text("steuersatz", { inputMode: "decimal" })}
              </div>
            </F>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <F label="Netto 7 %" error={errors.netto7}>{text("netto7", { inputMode: "decimal" })}</F>
            <F label="Netto 19 %" error={errors.netto19}>{text("netto19", { inputMode: "decimal" })}</F>
            <F label="Netto 0 %" error={errors.netto0}>{text("netto0", { inputMode: "decimal" })}</F>
          </div>
        )}
        {errors.tax && <p role="alert" className="text-xs text-destructive">{errors.tax}</p>}
        <div className="flex gap-4 text-xs font-mono text-muted-foreground" data-testid={`text-${idPrefix}-preview`}>
          <span>Netto {preview?.netto != null ? formatNumber(preview.netto) : "—"}</span>
          <span>Steuer {preview?.steuer != null ? formatNumber(preview.steuer) : "—"}</span>
          <span className="text-foreground font-semibold">Brutto {preview?.brutto != null ? formatNumber(preview.brutto) : "—"}</span>
        </div>
        <p className="text-[11px] text-muted-foreground">Höchstens zwei Nachkommastellen; es wird nichts stillschweigend gerundet.</p>
      </div>

      <datalist id={listId}>{konten.map((k) => <option key={k.id} value={k.kontonummer}>{k.bezeichnung}</option>)}</datalist>
      <div className="grid grid-cols-2 gap-3">
        <F label="Buchungskonto 1">{text("buchungskonto1", { list: listId })}</F>
        <F label="Betrag Konto 1" error={errors.buchungskonto1Betrag}>{text("buchungskonto1Betrag", { inputMode: "decimal" })}</F>
        <F label="Buchungskonto 2">{text("buchungskonto2", { list: listId })}</F>
        <F label="Betrag Konto 2" error={errors.buchungskonto2Betrag}>{text("buchungskonto2Betrag", { inputMode: "decimal" })}</F>
      </div>
      <F label="Bemerkung">{text("bemerkung")}</F>
      <div className="grid grid-cols-3 gap-2">
        <F label="Feld 1">{text("freifeld1")}</F>
        <F label="Feld 2">{text("freifeld2")}</F>
        <F label="Feld 3">{text("freifeld3")}</F>
      </div>
    </fieldset>
  );
}
