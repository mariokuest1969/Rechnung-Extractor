import { createHash, randomBytes } from "node:crypto";
import { encryptDropboxValue, decryptDropboxValue, tokenRequest } from "./dropbox-oauth-security";
import { and, eq, like, lt } from "drizzle-orm";
import { db, settingsTable } from "@workspace/db";

const CONFIG_KEY = "dropbox_oauth";
const PENDING_PREFIX = "dropbox_pending_";
interface Credentials {
  appKey: string;
  appSecret: string;
  refreshToken: string;
}
interface Pending {
  appKey: string;
  appSecret: string;
  userId: string;
  verifier: string;
  redirectUri: string;
  expires: number;
}

async function readCredentials(): Promise<Credentials | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, CONFIG_KEY));
  return row ? decryptDropboxValue<Credentials>(row.value) : null;
}

export async function dropboxAppInfo() {
  const credentials = await readCredentials();
  return { appKey: credentials?.appKey ?? "", configured: Boolean(credentials) };
}

export async function beginDropboxAuthorization(
  input: { appKey?: string; appSecret?: string; redirectUri: string },
  userId: string,
) {
  const existing = await readCredentials();
  const appKey = input.appKey?.trim() || existing?.appKey;
  const appSecret = input.appSecret?.trim() || (appKey === existing?.appKey ? existing?.appSecret : undefined);
  if (!appKey || !appSecret) throw new Error("Bitte App Key und App Secret eingeben.");
  const state = `dbx_${randomBytes(32).toString("hex")}`;
  const verifier = randomBytes(48).toString("base64url");
  const pending: Pending = { appKey, appSecret, verifier, userId, redirectUri: input.redirectUri, expires: Date.now() + 10 * 60_000 };
  await db.delete(settingsTable).where(and(like(settingsTable.key, `${PENDING_PREFIX}%`), lt(settingsTable.updatedAt, new Date(Date.now() - 10 * 60_000))));
  await db.insert(settingsTable).values({ key: PENDING_PREFIX + state, value: encryptDropboxValue(pending) });
  const url = new URL("https://www.dropbox.com/oauth2/authorize");
  url.search = new URLSearchParams({
    client_id: appKey, response_type: "code", token_access_type: "offline",
    redirect_uri: input.redirectUri, state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString() };
}

let cached: { config: string; token: string; expires: number } | null = null;
let refreshing: Promise<string | null> | null = null;

export async function finishDropboxAuthorization(state: string, code: string, userId: string) {
  const key = PENDING_PREFIX + state;
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  if (!row) throw new Error("Anmeldung ungültig oder bereits abgeschlossen. Bitte erneut verbinden.");
  const pending = decryptDropboxValue<Pending>(row.value);
  if (pending.userId !== userId || pending.expires < Date.now()) throw new Error("Anmeldung abgelaufen oder anderes Benutzerkonto. Bitte erneut verbinden.");
  // Atomically consume state before exchanging the one-use code.
  const consumed = await db.delete(settingsTable).where(and(eq(settingsTable.key, key), eq(settingsTable.value, row.value))).returning();
  if (!consumed.length) throw new Error("Anmeldung wurde bereits verarbeitet.");
  const tokens = await tokenRequest({
    grant_type: "authorization_code", code, code_verifier: pending.verifier,
    client_id: pending.appKey, client_secret: pending.appSecret, redirect_uri: pending.redirectUri,
  });
  if (!tokens.refresh_token) throw new Error("Dropbox hat keine dauerhafte Freigabe erteilt. Bitte erneut verbinden.");
  const value = encryptDropboxValue({ appKey: pending.appKey, appSecret: pending.appSecret, refreshToken: tokens.refresh_token });
  await db.transaction(async (tx) => {
    await tx.insert(settingsTable).values({ key: CONFIG_KEY, value }).onConflictDoUpdate({
      target: settingsTable.key, set: { value, updatedAt: new Date() },
    });
    await tx.delete(settingsTable).where(eq(settingsTable.key, "dropbox_token"));
  });
  cached = { config: value, token: tokens.access_token, expires: Date.now() + tokens.expires_in * 1000 - 60_000 };
  return { appKey: pending.appKey, configured: true };
}

export async function getDropboxOAuthToken(): Promise<string | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, CONFIG_KEY));
    if (!row) return null;
    if (cached?.config === row.value && cached.expires > Date.now()) return cached.token;
    const config = decryptDropboxValue<Credentials>(row.value);
    const tokens = await tokenRequest({
      grant_type: "refresh_token", refresh_token: config.refreshToken,
      client_id: config.appKey, client_secret: config.appSecret,
    });
    cached = { config: row.value, token: tokens.access_token, expires: Date.now() + tokens.expires_in * 1000 - 60_000 };
    return tokens.access_token;
  })();
  try { return await refreshing; } finally { refreshing = null; }
}
