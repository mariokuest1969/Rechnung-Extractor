import { db, invoicesTable } from "@workspace/db";

// Read-only: apply schema changes through development setup / approved migrations.
export async function assertInvoiceSchema(): Promise<void> {
  try {
    await db.select({
      bearbeitungsstatus: invoicesTable.bearbeitungsstatus,
      steuerModus: invoicesTable.steuerModus,
      netto7: invoicesTable.netto7,
      netto19: invoicesTable.netto19,
      netto0: invoicesTable.netto0,
      steuer7: invoicesTable.steuer7,
      steuer19: invoicesTable.steuer19,
      steuer0: invoicesTable.steuer0,
    }).from(invoicesTable).limit(0);
  } catch (cause) {
    throw new Error(
      "Rechnungsschema nicht bereit. In der Entwicklung `pnpm --filter @workspace/db run setup:dev` ausführen. " +
      "In Produktion das Schema über den freigegebenen Veröffentlichungsprozess aktualisieren.",
      { cause },
    );
  }
}
