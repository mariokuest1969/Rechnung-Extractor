import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Process-local signing key: a restart invalidates previews, never accepts untrusted hashes.
const previewKey = randomBytes(32);
const lifetimeMs = 24 * 60 * 60 * 1000;
export const hashPdf = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function signPdfFingerprint(bytes: Uint8Array): string {
  const payload = `${hashPdf(bytes)}.${Date.now() + lifetimeMs}`;
  return `${payload}.${createHmac("sha256", previewKey).update(payload).digest("hex")}`;
}
export function verifyPdfFingerprint(token: string): string | null {
  const match = /^([a-f0-9]{64})\.(\d{13})\.([a-f0-9]{64})$/.exec(token);
  if (!match || Number(match[2]) < Date.now()) return null;
  const expected = createHmac("sha256", previewKey).update(`${match[1]}.${match[2]}`).digest();
  return timingSafeEqual(expected, Buffer.from(match[3], "hex")) ? match[1] : null;
}
