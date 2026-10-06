import assert from "node:assert/strict";
import test from "node:test";
import {
  ReextractTimeoutError,
  getReextractErrorHttpStatus,
  keepExistingPositionsWhenExtractionIsEmpty,
  withReextractTimeout,
} from "./reextract";

test("a non-ending extraction times out within the configured limit", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    withReextractTimeout(() => new Promise(() => undefined), 25),
    ReextractTimeoutError
  );
  assert.ok(Date.now() - startedAt < 500);
});

test("timeout aborts the extraction signal", async () => {
  let aborted = false;
  await assert.rejects(
    withReextractTimeout(
      (signal) =>
        new Promise<void>(() => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
        }),
      25
    ),
    ReextractTimeoutError
  );
  assert.equal(aborted, true);
});

test("a timeout maps to HTTP 504 and cannot reach persistence", async () => {
  let persisted = false;
  await assert.rejects(
    (async () => {
      await withReextractTimeout(() => new Promise(() => undefined), 25);
      persisted = true;
    })(),
    ReextractTimeoutError
  );
  assert.equal(
    getReextractErrorHttpStatus(new ReextractTimeoutError(), () => false),
    504
  );
  assert.equal(persisted, false);
});

test("an empty extraction preserves existing positions", () => {
  const existing = [{ beschreibung: "Vorhandene Position" }];
  assert.deepEqual(
    keepExistingPositionsWhenExtractionIsEmpty([], existing),
    existing
  );
});

test("successful extraction replaces existing positions", () => {
  const extracted = [{ beschreibung: "Neue Position" }];
  assert.deepEqual(
    keepExistingPositionsWhenExtractionIsEmpty(extracted, [
      { beschreibung: "Alt" },
    ]),
    extracted
  );
});