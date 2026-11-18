# Invoice review status rollout

Apply the additive schema change before starting the updated API. Development
and post-merge setup use the guarded `pnpm --filter @workspace/db run setup:dev`.
Production schema changes must use the approved deployment process, never the
development setup command.

Equivalent idempotent migration for that process:

```sql
BEGIN;
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS bearbeitungsstatus text NOT NULL DEFAULT 'unreviewed';
UPDATE invoices SET bearbeitungsstatus = 'unreviewed'
  WHERE bearbeitungsstatus IS NULL;
ALTER TABLE invoices ALTER COLUMN bearbeitungsstatus SET DEFAULT 'unreviewed';
ALTER TABLE invoices ALTER COLUMN bearbeitungsstatus SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'invoices'::regclass
      AND conname = 'invoices_review_status_check'
  ) THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_review_status_check
      CHECK (bearbeitungsstatus IN ('unreviewed', 'to_review', 'done'));
  END IF;
END $$;
COMMIT;
```

No historical record is inferred to be reviewed. All imports, including
preview-confirmed uploads, start as `unreviewed`. Only explicit single or bulk
edits change this state; extraction must never write it on existing invoices.
The startup check is read-only and reports missing schema before polling begins.
