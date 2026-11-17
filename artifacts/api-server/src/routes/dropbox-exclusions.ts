import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db, settingsTable } from "@workspace/db";
import { ListDropboxExclusionsResponse, ReleaseDropboxExclusionBody } from "@workspace/api-zod";
import { duplicateExclusionPrefix } from "../lib/invoice-duplicates";

const router: IRouter = Router();

router.get("/settings/dropbox-exclusions", async (_req, res): Promise<void> => {
  // Literal prefix comparison: underscores in the namespace are not LIKE wildcards.
  const rows = await db.select().from(settingsTable)
    .where(sql`left(${settingsTable.key}, ${duplicateExclusionPrefix.length}) = ${duplicateExclusionPrefix}`)
    .orderBy(desc(settingsTable.updatedAt), settingsTable.key);
  res.json(ListDropboxExclusionsResponse.parse(rows.map(row => {
    let filename: string | null = null;
    try {
      const value = JSON.parse(row.value);
      if (typeof value?.filename === "string") filename = value.filename;
    } catch { /* Legacy exclusions stored "1"; the Dropbox ID remains reviewable. */ }
    return {
      fileId: row.key.slice(duplicateExclusionPrefix.length),
      filename,
      excludedAt: row.updatedAt.toISOString(),
    };
  })));
});

router.post("/settings/dropbox-exclusions/release", async (req, res): Promise<void> => {
  const input = ReleaseDropboxExclusionBody.safeParse(req.body);
  if (!input.success || !input.data.fileId.trim()) {
    res.status(400).json({ error: "Bitte genau eine Dropbox-Datei auswählen." });
    return;
  }
  const removed = await db.transaction(async tx => {
    // Serialize with duplicate cleanup and the sync's final import write.
    await tx.execute(sql`LOCK TABLE invoices IN SHARE ROW EXCLUSIVE MODE`);
    return tx.delete(settingsTable)
      .where(eq(settingsTable.key, duplicateExclusionPrefix + input.data.fileId))
      .returning({ key: settingsTable.key });
  });
  if (!removed.length) {
    res.status(404).json({ error: "Dieser Ausschluss besteht nicht mehr. Bitte die Liste aktualisieren." });
    return;
  }
  res.sendStatus(204);
});

export default router;
