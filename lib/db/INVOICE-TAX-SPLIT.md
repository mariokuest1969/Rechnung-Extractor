# Optional net tax split

Apply the exported Drizzle schema through the existing development setup or the
approved production schema workflow before running the updated API.

Equivalent idempotent SQL for that approved workflow (do not run development
setup against production):

```sql
BEGIN;
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS steuer_modus text NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS netto7 numeric(12,2),
  ADD COLUMN IF NOT EXISTS netto19 numeric(12,2),
  ADD COLUMN IF NOT EXISTS netto0 numeric(12,2),
  ADD COLUMN IF NOT EXISTS steuer7 numeric(12,2),
  ADD COLUMN IF NOT EXISTS steuer19 numeric(12,2),
  ADD COLUMN IF NOT EXISTS steuer0 numeric(12,2);
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'invoices'::regclass
      AND conname = 'invoices_tax_mode_check'
  ) THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_tax_mode_check
      CHECK (steuer_modus IN ('single', 'split'));
  END IF;
END $$;
COMMIT;
```

Startup probes the new columns read-only before starting the Dropbox poller and
reports a missing migration rather than serving partially working invoice routes.

This is an additive migration: `steuer_modus` defaults to `single`; all six
per-rate numeric(12,2) fields are nullable. Existing totals are not recalculated,
and no historic allocation is inferred. `invoices_tax_mode_check` restricts the
mode to `single` / `split`.

Split edits are calculated on the server under a row lock and written in one
update. Commercial rounding is per rate, in integer cents, with negative ties
rounded away from zero. Null means absent, whereas an explicit zero remains zero.
At least one net must be present. Each component and all totals must fit
numeric(12,2).

Switching back to `single` explicitly clears the split but retains totals. A
single tax rate must then be chosen by the user; it is never inferred from mixed
amounts. Bulk rate changes reject the entire selection if any split is active.
Re-extraction respects the current mode at commit time.
