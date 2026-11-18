import { db, invoicesTable, bookingTemplatesTable, bookingOccurrencesTable } from "@workspace/db";

export async function assertBookingSchema(): Promise<void> {
  try {
    await db.select({ herkunft: invoicesTable.herkunft, template: invoicesTable.wiederholungVorlageId, due: invoicesTable.faelligkeitsdatum }).from(invoicesTable).limit(0);
    await db.select().from(bookingTemplatesTable).limit(0);
    await db.select().from(bookingOccurrencesTable).limit(0);
  } catch (cause) {
    throw new Error("Buchungsschema nicht bereit. Entwicklung: `pnpm --filter @workspace/db run setup:dev`. Produktion: Schema über den freigegebenen Veröffentlichungsprozess aktualisieren.", { cause });
  }
}
