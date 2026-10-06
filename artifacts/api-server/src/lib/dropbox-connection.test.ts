import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { assertDropboxConnection, checkDropboxResponse, DropboxAuthError, needsDropboxReconnect, resetDropboxConnection } from "./dropbox-connection";
import { tokenRequest } from "./dropbox-oauth-security";

afterEach(resetDropboxConnection);

test("401 pauses subsequent Dropbox calls until reconnection", async () => {
  await assert.rejects(checkDropboxResponse(new Response("", { status: 401 })), DropboxAuthError);
  assert.equal(needsDropboxReconnect(), true);
  assert.throws(assertDropboxConnection, DropboxAuthError);
  resetDropboxConnection();
  assert.doesNotThrow(assertDropboxConnection);
});

test("folder, permission, rate-limit and service errors do not pause authentication", async () => {
  for (const status of [403, 409, 429, 500, 503]) {
    const response = new Response("", { status });
    assert.equal(await checkDropboxResponse(response), response);
    assert.equal(needsDropboxReconnect(), false);
  }
});

test("revoked refresh grant requires reconnection, not repeated token requests", async () => {
  const request = (async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as typeof fetch;
  await assert.rejects(tokenRequest({ grant_type: "refresh_token" }, request), DropboxAuthError);
  assert.equal(needsDropboxReconnect(), true);
});

test("temporary token failures and failed new authorizations do not invalidate connection", async () => {
  for (const [grant_type, status, error] of [
    ["refresh_token", 503, "server_error"],
    ["authorization_code", 400, "invalid_grant"],
  ] as const) {
    const request = (async () => new Response(JSON.stringify({ error }), { status })) as typeof fetch;
    await assert.rejects(tokenRequest({ grant_type }, request), (err: unknown) =>
      err instanceof Error && !(err instanceof DropboxAuthError));
    assert.equal(needsDropboxReconnect(), false);
  }
});
