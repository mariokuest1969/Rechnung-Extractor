import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const buchungskontenTable = pgTable("buchungskonten", {
  id: serial("id").primaryKey(),
  kontonummer: text("kontonummer").notNull().unique(),
  bezeichnung: text("bezeichnung").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Buchungskonto = typeof buchungskontenTable.$inferSelect;
