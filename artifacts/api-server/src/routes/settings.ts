import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, settingsTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const SETTING_DROPBOX_FOLDER = "dropbox_folder";
const DEFAULT_DROPBOX_FOLDER = "/Apps/roc.Kasse/RE-2026";

async function getSetting(key: string, defaultValue: string): Promise<string> {
  const [row] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, key))
    .limit(1);
  return row?.value ?? defaultValue;
}

export async function getDropboxFolder(): Promise<string> {
  return getSetting(SETTING_DROPBOX_FOLDER, DEFAULT_DROPBOX_FOLDER);
}

// GET /settings
router.get("/settings", async (_req, res): Promise<void> => {
  const dropboxFolder = await getSetting(
    SETTING_DROPBOX_FOLDER,
    DEFAULT_DROPBOX_FOLDER
  );
  res.json({ dropboxFolder });
});

// PATCH /settings
router.patch("/settings", async (req, res): Promise<void> => {
  const { dropboxFolder } = req.body as { dropboxFolder?: unknown };

  if (typeof dropboxFolder !== "string" || dropboxFolder.trim() === "") {
    res.status(400).json({ error: "dropboxFolder muss ein gültiger Pfad sein" });
    return;
  }

  const cleaned = dropboxFolder.trim();

  await db
    .insert(settingsTable)
    .values({ key: SETTING_DROPBOX_FOLDER, value: cleaned })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: cleaned, updatedAt: new Date() },
    });

  logger.info({ dropboxFolder: cleaned }, "Settings updated: dropbox folder");
  res.json({ dropboxFolder: cleaned });
});

export default router;
