import assert from "node:assert/strict";
import test from "node:test";
import { decryptDropboxValue, encryptDropboxValue, tokenRequest } from "./dropbox-oauth-security";

test("Dropbox credentials are encrypted with unique nonces and reject tampering", () => {
  const value = { appSecret: "test-only-secret", refreshToken: "test-only-refresh" };
  const encrypted = encryptDropboxValue(value);
  assert.ok(!encrypted.includes(value.appSecret));
  assert.notEqual(encrypted, encryptDropboxValue(value));
  assert.deepEqual(decryptDropboxValue(encrypted), value);
  const parts = encrypted.split(".");
  const bytes = Buffer.from(parts[2], "base64url");
  bytes[0] ^= 1;
  parts[2] = bytes.toString("base64url");
  assert.throws(() => decryptDropboxValue(parts.join(".")));
});

test("Dropbox refresh sends form-encoded credentials only to the token endpoint", async () => {
  const result = await tokenRequest(
    { grant_type: "refresh_token", refresh_token: "fake-refresh", client_id: "fake-key", client_secret: "fake-secret" },
    async (url, init) => {
      assert.equal(url, "https://api.dropboxapi.com/oauth2/token");
      assert.equal(init?.method, "POST");
      assert.ok(init?.body instanceof URLSearchParams);
      assert.equal(init.body.get("grant_type"), "refresh_token");
      assert.equal(init.body.get("client_secret"), "fake-secret");
      return Response.json({ access_token: "fake-access", expires_in: 14400 });
    },
  );
  assert.equal(result.access_token, "fake-access");
});

test("Dropbox token failures are explicit and do not expose provider response bodies", async () => {
  await assert.rejects(tokenRequest({}, async () => new Response("sensitive-provider-body", { status: 401 })), (err: Error) => {
    assert.match(err.message, /Dropbox-Anmeldung fehlgeschlagen/);
    assert.ok(!err.message.includes("sensitive-provider-body"));
    return true;
  });
  await assert.rejects(tokenRequest({}, async () => Response.json({})), /keinen gültigen Zugriff/);
});
