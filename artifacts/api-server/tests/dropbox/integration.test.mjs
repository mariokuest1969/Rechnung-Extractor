import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import express from "express";

const bundleUrl = pathToFileURL(process.env.DROPBOX_TEST_BUNDLE).href;
const redirectUri = "https://re2026.test/dropbox/callback";
const credentials = { appKey: "test-key", appSecret: "test-secret", redirectUri };
const nativeFetch = globalThis.fetch;
let sequence = 0;

async function fixture(t) {
  const api = await import(`${bundleUrl}?instance=${sequence++}`);
  const calls = [];
  let reply = () => Response.json({ access_token: "test-access", refresh_token: "test-refresh", expires_in: 3600 });
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.dropboxapi.com/oauth2/token", "no other outbound request is permitted");
    assert.equal(init.method, "POST");
    assert.ok(init.body instanceof URLSearchParams);
    calls.push(Object.fromEntries(init.body));
    return reply();
  };
  t.after(() => { globalThis.fetch = nativeFetch; });
  const app = express();
  app.use(express.json());
  // The production parent router authenticates before mounting these routes.
  // Supply only a synthetic identity here; never load Clerk credentials.
  app.use((req, res, next) => req.headers["x-test-user"] ? next() : res.sendStatus(401));
  app.use(api.router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const request = async (path, body, user = "owner", origin = "https://re2026.test") => {
    const response = await nativeFetch(`http://127.0.0.1:${server.address().port}/settings/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", origin, "x-test-user": user },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, cache: response.headers.get("cache-control"), body: await response.json() };
  };
  const begin = async () => {
    const result = await request("dropbox-authorize", credentials);
    assert.equal(result.status, 200);
    assert.equal(result.cache, "no-store");
    return new URL(result.body.url);
  };
  const complete = (state, user = "owner") => request("dropbox-complete", { state, code: "test-code" }, user);
  return { api, calls, request, begin, complete, respond: fn => { reply = fn; } };
}

test("authorization routes persist encrypted credentials, PKCE and sanitized status; replay is rejected", async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.request("dropbox-app")).body, { appKey: "", configured: false });
  f.api.rows.set("dropbox_token", { key: "dropbox_token", value: "legacy-test-token", updatedAt: new Date() });
  const url = await f.begin();
  const state = url.searchParams.get("state");
  const pendingRow = f.api.rows.get(`dropbox_pending_${state}`);
  const pending = f.api.decryptDropboxValue(pendingRow.value);
  assert.throws(() => f.api.requireDropboxReconnect());
  assert.equal(pending.userId, "owner");
  assert.equal(pending.redirectUri, redirectUri);
  assert.ok(!pendingRow.value.includes(credentials.appSecret));
  assert.equal(url.origin + url.pathname, "https://www.dropbox.com/oauth2/authorize");
  assert.equal(url.searchParams.get("token_access_type"), "offline");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), createHash("sha256").update(pending.verifier).digest("base64url"));
  const result = await f.complete(state);
  assert.equal(result.status, 200);
  assert.equal(f.api.needsDropboxReconnect(), false);
  assert.equal(result.cache, "no-store");
  assert.deepEqual(result.body, { appKey: credentials.appKey, configured: true });
  const saved = f.api.rows.get("dropbox_oauth").value;
  assert.ok(!saved.includes("test-refresh"));
  assert.deepEqual(f.api.decryptDropboxValue(saved), {
    appKey: credentials.appKey, appSecret: credentials.appSecret, refreshToken: "test-refresh",
  });
  assert.equal(f.api.rows.has("dropbox_token"), false);
  assert.equal(f.api.rows.has(`dropbox_pending_${state}`), false);
  assert.deepEqual(f.calls, [{
    grant_type: "authorization_code", code: "test-code", code_verifier: pending.verifier,
    client_id: credentials.appKey, client_secret: credentials.appSecret, redirect_uri: redirectUri,
  }]);
  assert.equal(await f.api.getDropboxOAuthToken(), "test-access");
  assert.equal((await f.complete(state)).status, 400);
  const info = await f.request("dropbox-app");
  assert.equal(info.cache, "no-store");
  assert.deepEqual(info.body, result.body);
  assert.equal(f.calls.length, 1);
});

test("state is user-bound; a wrong user cannot consume it, and expiry/unknown state cannot exchange tokens", async t => {
  const f = await fixture(t);
  const state = (await f.begin()).searchParams.get("state");
  assert.equal((await f.complete(state, "other-user")).status, 400);
  assert.ok(f.api.rows.has(`dropbox_pending_${state}`));
  assert.equal(f.calls.length, 0);
  assert.equal((await f.complete(state)).status, 200);
  const expired = (await f.begin()).searchParams.get("state");
  const row = f.api.rows.get(`dropbox_pending_${expired}`);
  row.value = f.api.encryptDropboxValue({ ...f.api.decryptDropboxValue(row.value), expires: Date.now() - 1 });
  const previous = f.api.rows.get("dropbox_oauth").value;
  assert.equal((await f.complete(expired)).status, 400);
  assert.equal((await f.complete(`dbx_${"a".repeat(64)}`)).status, 400);
  assert.equal(f.calls.length, 1);
  assert.equal(f.api.rows.get("dropbox_oauth").value, previous);
});

test("route validation rejects unsafe redirects and malformed callback data before any writes or token calls", async t => {
  const f = await fixture(t);
  for (const uri of ["http://re2026.test/callback", "https://evil.test/callback", `${redirectUri}?x=1`, `${redirectUri}#x`, "https://user:pass@re2026.test/callback"]) {
    assert.equal((await f.request("dropbox-authorize", { ...credentials, redirectUri: uri })).status, 400);
  }
  for (const body of [{}, { state: "bad", code: "x" }, { state: `dbx_${"a".repeat(64)}`, code: "x".repeat(4097) }]) {
    assert.equal((await f.request("dropbox-complete", body)).status, 400);
  }
  assert.equal(f.api.rows.size, 0);
  assert.equal(f.calls.length, 0);
});

for (const failure of ["provider rejection", "network failure", "missing refresh token", "commit failure"]) {
  test(`failed authorization preserves prior OAuth and legacy credentials: ${failure}`, async t => {
    const f = await fixture(t);
    const old = f.api.encryptDropboxValue({ appKey: "old-key", appSecret: "old-secret", refreshToken: "old-refresh" });
    f.api.seed([
      { key: "dropbox_oauth", value: old, updatedAt: new Date() },
      { key: "dropbox_token", value: "old-legacy", updatedAt: new Date() },
    ]);
    const state = (await f.begin()).searchParams.get("state");
    if (failure === "provider rejection") f.respond(() => Response.json({ error: "sensitive-provider-error" }, { status: 400 }));
    if (failure === "network failure") f.respond(() => { throw new Error("sensitive-network-error"); });
    if (failure === "missing refresh token") f.respond(() => Response.json({ access_token: "new-access", expires_in: 3600 }));
    if (failure === "commit failure") f.api.setTransactionFailure(true);
    const result = await f.complete(state);
    assert.equal(result.status, 400);
    assert.ok(!JSON.stringify(result.body).includes("sensitive"));
    assert.equal(f.api.rows.get("dropbox_oauth").value, old);
    assert.equal(f.api.rows.get("dropbox_token").value, "old-legacy");
    assert.equal((await f.complete(state)).status, 400);
    assert.equal(f.calls.length, 1, "a failed token exchange still consumes the one-use state");
  });
}

test("simultaneous callback requests atomically consume state once", async t => {
  const f = await fixture(t);
  const state = (await f.begin()).searchParams.get("state");
  const results = await Promise.all(Array.from({ length: 8 }, () => f.complete(state)));
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.equal(results.filter(result => result.status === 400).length, 7);
  assert.equal(f.calls.length, 1);
});

test("a new Node process refreshes from persisted encrypted credentials without any access-token cache", async t => {
  const f = await fixture(t);
  await f.complete((await f.begin()).searchParams.get("state"));
  const snapshot = JSON.stringify([...f.api.rows.values()]);
  const script = `
    import assert from 'node:assert/strict';
    const api = await import(${JSON.stringify(bundleUrl)});
    let input = ''; for await (const chunk of process.stdin) input += chunk;
    api.seed(JSON.parse(input));
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'https://api.dropboxapi.com/oauth2/token');
      assert.deepEqual(Object.fromEntries(init.body), {
        grant_type: 'refresh_token', refresh_token: 'test-refresh',
        client_id: 'test-key', client_secret: 'test-secret'
      });
      calls++;
      return Response.json({access_token: 'after-restart', expires_in: 3600});
    };
    assert.equal(await api.getDropboxOAuthToken(), 'after-restart');
    assert.equal(await api.getDropboxOAuthToken(), 'after-restart');
    assert.equal(calls, 1);
    assert.equal(JSON.stringify([...api.rows.values()]), input);
  `;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      env: { SESSION_SECRET: "isolated-dropbox-test-secret" }, stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", code => resolve({ code, stderr }));
    child.stdin.end(snapshot);
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(f.calls.length, 1, "child refresh must not use parent process cache");
});

test("simultaneous refresh calls share one request; failed refresh can be retried and expiry triggers renewal", async t => {
  const f = await fixture(t);
  const saved = f.api.encryptDropboxValue({ appKey: "test-key", appSecret: "test-secret", refreshToken: "test-refresh" });
  f.api.seed([{ key: "dropbox_oauth", value: saved, updatedAt: new Date() }]);
  let release;
  f.respond(() => new Promise(resolve => { release = resolve; }));
  const requests = Array.from({ length: 12 }, () => f.api.getDropboxOAuthToken());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 1);
  release(Response.json({ error: "invalid_grant" }, { status: 401 }));
  const results = await Promise.allSettled(requests);
  assert.ok(results.every(result => result.status === "rejected"));
  assert.equal(f.api.needsDropboxReconnect(), true);
  assert.equal(f.api.rows.get("dropbox_oauth").value, saved);
  f.respond(() => Response.json({ access_token: "short-lived", expires_in: 61 }));
  assert.deepEqual(await Promise.all(Array.from({ length: 12 }, () => f.api.getDropboxOAuthToken())), Array(12).fill("short-lived"));
  assert.equal(f.calls.length, 2);
  assert.equal(await f.api.getDropboxOAuthToken(), "short-lived");
  assert.equal(f.calls.length, 2);
  const now = Date.now;
  t.after(() => { Date.now = now; });
  Date.now = () => now() + 2000;
  f.respond(() => Response.json({ access_token: "renewed", expires_in: 3600 }));
  assert.equal(await f.api.getDropboxOAuthToken(), "renewed");
  assert.equal(f.calls.length, 3);
  assert.equal(f.api.rows.get("dropbox_oauth").value, saved);
});
