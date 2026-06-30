import { pgTable, serial, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  rechnungssteller: text("rechnungssteller"),
  datum: text("datum"),
  rechnungsnummer: text("rechnungsnummer"),
  bruttoBetrag: numeric("brutto_betrag", { precision: 12, scale: 2 }),
  steuersatz: numeric("steuersatz", { precision: 5, scale: 2 }),
  steuerBetrag: numeric("steuer_betrag", { precision: 12, scale: 2 }),
  nettoBetrag: numeric("netto_betrag", { precision: 12, scale: 2 }),
  waehrung: text("waehrung").default("EUR"),
  bemerkung: text("bemerkung"),
  dateiname: text("dateiname"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ id: true, createdAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;
