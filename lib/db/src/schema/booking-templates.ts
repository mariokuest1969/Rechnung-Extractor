import { pgTable, serial, text, integer, jsonb, date, timestamp, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { invoicesTable } from "./invoices";

// Payload is validated by the versioned API contract at every write.
export const bookingTemplatesTable = pgTable("booking_templates", {
  id: serial("id").primaryKey(),
  booking: jsonb("booking").$type<Record<string, unknown>>().notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  intervalMonths: integer("interval_months").notNull(),
  status: text("status", { enum: ["active", "paused", "ended"] }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [
  check("booking_template_interval_check", sql`${table.intervalMonths} IN (1, 3, 12)`),
  check("booking_template_status_check", sql`${table.status} IN ('active', 'paused', 'ended')`),
]);

export const bookingOccurrencesTable = pgTable("booking_occurrences", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => bookingTemplatesTable.id),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  // Keep confirmation tombstones after deleting a booking: never recreate it.
  invoiceId: integer("invoice_id").references(() => invoicesTable.id, { onDelete: "set null" }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [unique("booking_occurrence_unique").on(table.templateId, table.dueDate)]);
