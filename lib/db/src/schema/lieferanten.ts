import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const lieferantenTable = pgTable("lieferanten", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  kuerzel: text("kuerzel"),
  steuernummer: text("steuernummer"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Lieferant = typeof lieferantenTable.$inferSelect;
