import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, settingsTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const SETTING_DROPBOX_FOLDER = "dropbox_folder";
const SETTING_DROPBOX_TOKEN  = "dropbox_token";
const DEFAULT_DROPBOX_FOLDER = "/Apps/Lake Mail/apps/Roc.Kasse/Lake-Male/2026";
const LEGACY_DROPBOX_FOLDER = "/Apps/Lake Mail/apps/Roc.Kasse/Lake-Male";

function normalizeDropboxFolder(folder: string): string {
  const trimmed = folder.trim();
  return trimmed === "/" ? "" : trimmed.replace(/\/+$/, "");
}

async function getSetting(key: string, defaultValue = ""): Promise<string> {
  const [row] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, key))
    .limit(1);
  return row?.value ?? defaultValue;
}

async function upsertSetting(key: string, value: string): Promise<void> {
  await db
    .insert(settingsTable)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function getDropboxFolder(): Promise<string> {
  const folder = normalizeDropboxFolder(
    await getSetting(SETTING_DROPBOX_FOLDER, DEFAULT_DROPBOX_FOLDER)
  );
  return folder.toLowerCase() === LEGACY_DROPBOX_FOLDER.toLowerCase()
    ? DEFAULT_DROPBOX_FOLDER
    : folder;
}

export async function getDropboxToken(): Promise<string | null> {
  const val = await getSetting(SETTING_DROPBOX_TOKEN);
  return val || null;
}

// GET /settings
router.get("/settings", async (_req, res): Promise<void> => {
  const dropboxFolder = await getDropboxFolder();
  const dropboxToken  = await getSetting(SETTING_DROPBOX_TOKEN);
  res.json({ dropboxFolder, dropboxTokenConfigured: dropboxToken.length > 0 });
});

// PATCH /settings
router.patch("/settings", async (req, res): Promise<void> => {
  const { dropboxFolder, dropboxToken } = req.body as {
    dropboxFolder?: unknown;
    dropboxToken?: unknown;
  };

  if (dropboxFolder !== undefined) {
    if (typeof dropboxFolder !== "string" || !dropboxFolder.trim()) {
      res.status(400).json({ error: "dropboxFolder muss ein gültiger Pfad sein" });
      return;
    }
    const normalizedFolder = normalizeDropboxFolder(dropboxFolder);
    await upsertSetting(SETTING_DROPBOX_FOLDER, normalizedFolder);
    logger.info(
      { dropboxFolder: normalizedFolder },
      "Settings updated: dropbox folder"
    );
  }

  if (dropboxToken !== undefined) {
    if (dropboxToken !== null && typeof dropboxToken !== "string") {
      res.status(400).json({ error: "dropboxToken muss ein String oder null sein" });
      return;
    }
    const tokenVal = typeof dropboxToken === "string" ? dropboxToken.trim() : "";
    await upsertSetting(SETTING_DROPBOX_TOKEN, tokenVal);
    logger.info({ hasToken: tokenVal.length > 0 }, "Settings updated: dropbox token");
  }

  const updatedFolder = await getSetting(SETTING_DROPBOX_FOLDER, DEFAULT_DROPBOX_FOLDER);
  const updatedToken  = await getSetting(SETTING_DROPBOX_TOKEN);
  res.json({ dropboxFolder: updatedFolder, dropboxTokenConfigured: updatedToken.length > 0 });
});

export default router;
