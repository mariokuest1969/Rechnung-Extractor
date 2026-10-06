import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function encryptionKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Sichere Speicherung ist nicht konfiguriert.");
  return createHash("sha256").update(`dropbox-oauth:${secret}`).digest();
}

export function encryptDropboxValue(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptDropboxValue<T>(value: string): T {
  const [iv, tag, ciphertext] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
}

export async function tokenRequest(params: Record<string, string>, request: typeof fetch = fetch): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const response = await request("https://api.dropboxapi.com/oauth2/token", {
    method: "POST", body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("Dropbox-Anmeldung fehlgeschlagen. Bitte App-Daten und Freigabe prüfen und erneut verbinden.");
  const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!data.access_token || !data.expires_in) throw new Error("Dropbox hat keinen gültigen Zugriff zurückgegeben.");
  return { ...data, access_token: data.access_token, expires_in: data.expires_in };
}
