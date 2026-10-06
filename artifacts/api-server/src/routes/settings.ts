import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, settingsTable } from "@workspace/db";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { GetDropboxStatusResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { getDropboxOAuthToken } from "../lib/dropbox-oauth";
import { assertDropboxConnection, checkDropboxResponse, DropboxAuthError, resetDropboxConnection } from "../lib/dropbox-connection";

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
  assertDropboxConnection();
  const oauthToken = await getDropboxOAuthToken();
  if (oauthToken) return oauthToken;
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
    resetDropboxConnection();
    logger.info({ hasToken: tokenVal.length > 0 }, "Settings updated: dropbox token");
  }

  const updatedFolder = await getSetting(SETTING_DROPBOX_FOLDER, DEFAULT_DROPBOX_FOLDER);
  const updatedToken  = await getSetting(SETTING_DROPBOX_TOKEN);
  res.json({ dropboxFolder: updatedFolder, dropboxTokenConfigured: updatedToken.length > 0 });
});

// GET /settings/dropbox-status
router.get("/settings/dropbox-status", async (_req, res): Promise<void> => {
  const folder = await getDropboxFolder();
  let connectionMethod = "personal_token";
  const checkedAt = new Date().toISOString();

  try {
    const token = await getDropboxToken();
    connectionMethod = token ? "personal_token" : "replit_connector";
    const body = JSON.stringify({ path: folder, recursive: false, limit: 1 });
    const response = token
      ? await fetch("https://api.dropboxapi.com/2/files/list_folder", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body,
        })
      : await new ReplitConnectors().proxy(
          "dropbox",
          "/2/files/list_folder",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          }
        );

    await checkDropboxResponse(response);
    if (response.ok) {
      res.json(
        GetDropboxStatusResponse.parse({
          state: "connected",
          message: "Dropbox ist verbunden und der Zielordner ist erreichbar.",
          folder,
          connectionMethod,
          checkedAt,
        })
      );
      return;
    }

    const state =
      response.status === 401
        ? "disconnected"
        : response.status === 409
          ? "wrong_folder"
          : "error";
    const message =
      state === "disconnected"
        ? "Die Dropbox-Anmeldung ist abgelaufen oder wurde widerrufen."
        : state === "wrong_folder"
          ? "Dropbox ist verbunden, aber der eingestellte Zielordner wurde nicht gefunden."
          : `Dropbox konnte nicht geprüft werden (Status ${response.status}).`;

    logger.warn(
      { status: response.status, state, folder },
      "Dropbox connection check failed"
    );
    res.json(
      GetDropboxStatusResponse.parse({
        state,
        message,
        folder,
        connectionMethod,
        checkedAt,
      })
    );
  } catch (err) {
    const authError = err instanceof DropboxAuthError;
    if (!authError) logger.warn({ err, folder }, "Dropbox connection check errored");
    res.json(
      GetDropboxStatusResponse.parse({
        state: authError ? "disconnected" : "error",
        message: authError ? err.message : "Dropbox konnte momentan nicht erreicht werden.",
        folder,
        connectionMethod,
        checkedAt,
      })
    );
  }
});

export default router;
