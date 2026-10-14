import { db, reextractJobsTable } from "@workspace/db";

// Read-only preflight: schema changes belong to dev setup, never server startup.
export async function assertReextractSchema(
  probe: () => Promise<unknown> = () => db.select().from(reextractJobsTable).limit(0),
): Promise<void> {
  try {
    await probe();
  } catch (error) {
    let cause: unknown = error;
    const visited = new Set<unknown>();
    while (cause && typeof cause === "object" && !visited.has(cause)) {
      visited.add(cause);
      const current = cause as { code?: string; cause?: unknown };
      if (current.code === "42P01" || current.code === "42703") {
        throw new Error(
          "Datenbankschema für Neu-Auslesungen fehlt oder ist unvollständig (reextract_jobs). " +
          "In der Entwicklung: `pnpm --filter @workspace/db run setup:dev` ausführen und Server neu starten. " +
          "In Produktion: Schema nur über den freigegebenen Veröffentlichungsprozess aktualisieren.",
        );
      }
      cause = current.cause;
    }
    throw error;
  }
}
