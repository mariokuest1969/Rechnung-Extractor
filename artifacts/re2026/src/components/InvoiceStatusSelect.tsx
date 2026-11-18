import type { InvoiceReviewStatus } from "@workspace/api-client-react";

export const REVIEW_STATUS_LABELS: Record<InvoiceReviewStatus, string> = {
  unreviewed: "Nur eingelesen – nicht geprüft",
  to_review: "Zu bearbeiten",
  done: "Fertig",
};

export function InvoiceStatusSelect({ value, onChange, label = "Bearbeitungsstatus", disabled = false, unchanged = false }: {
  value: InvoiceReviewStatus | "";
  onChange: (value: InvoiceReviewStatus | "") => void;
  label?: string;
  disabled?: boolean;
  unchanged?: boolean;
}) {
  return (
    <select aria-label={label} value={value} disabled={disabled}
      onChange={event => onChange(event.target.value as InvoiceReviewStatus | "")}
      className={`max-w-full border border-border rounded px-2 py-1.5 text-sm bg-background ${value === "done" ? "text-emerald-700 dark:text-emerald-400" : value === "to_review" ? "text-amber-700 dark:text-amber-400" : ""}`}>
      {unchanged && <option value="">— nicht ändern —</option>}
      {Object.entries(REVIEW_STATUS_LABELS).map(([status, text]) => <option key={status} value={status}>{text}</option>)}
    </select>
  );
}
