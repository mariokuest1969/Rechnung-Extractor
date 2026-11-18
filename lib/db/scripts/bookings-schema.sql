-- Additive, repeatable migration for an explicitly approved schema workflow.
-- Never execute this file from application startup.
BEGIN;
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS herkunft text NOT NULL DEFAULT 'pdf',
  ADD COLUMN IF NOT EXISTS wiederholung_vorlage_id integer,
  ADD COLUMN IF NOT EXISTS faelligkeitsdatum text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoices'::regclass AND conname = 'invoices_origin_check') THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_origin_check CHECK (herkunft IN ('pdf', 'manual', 'recurring'));
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS booking_templates (
  id serial PRIMARY KEY,
  booking jsonb NOT NULL,
  start_date date NOT NULL,
  interval_months integer NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_template_interval_check CHECK (interval_months IN (1,3,12)),
  CONSTRAINT booking_template_status_check CHECK (status IN ('active','paused','ended'))
);
CREATE TABLE IF NOT EXISTS booking_occurrences (
  id serial PRIMARY KEY,
  template_id integer NOT NULL REFERENCES booking_templates(id),
  due_date date NOT NULL,
  invoice_id integer REFERENCES invoices(id) ON DELETE SET NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_occurrence_unique UNIQUE (template_id, due_date)
);
COMMIT;
