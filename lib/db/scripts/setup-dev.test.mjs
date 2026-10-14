import { test } from "node:test";
import assert from "node:assert/strict";
import { assertDevelopment } from "./setup-dev.mjs";

test("development setup refuses production before opening a connection", () => {
  for (const env of [
    { NODE_ENV: "production" },
    { REPLIT_DEPLOYMENT: "1" },
  ]) {
    assert.throws(() => assertDevelopment({ DATABASE_URL: "unused", ...env }), /nur in der Entwicklungsumgebung/);
  }
});

test("development setup requires a configured database", () => {
  assert.throws(() => assertDevelopment({}), /DATABASE_URL fehlt/);
  // REPLIT_ENVIRONMENT describes the platform, not whether this is a deployment.
  assert.doesNotThrow(() => assertDevelopment({ DATABASE_URL: "unused", REPLIT_ENVIRONMENT: "production" }));
});
