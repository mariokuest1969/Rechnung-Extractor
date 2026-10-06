import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const reextractJobsTable = pgTable("reextract_jobs", {
  id: text("id").primaryKey(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  result: jsonb("result").$type<Record<string, unknown>>(),
}, (table) => [index("reextract_jobs_expiry_idx").on(table.expiresAt)]);
