import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const directory = await mkdtemp(fileURLToPath(new URL(".dropbox-tests-", root)));
const bundle = `${directory}/oauth.mjs`;
try {
  await build({
    entryPoints: [fileURLToPath(new URL("entry.ts", import.meta.url))],
    outfile: bundle, bundle: true, platform: "node", format: "esm",
    packages: "external",
    alias: {
      "@workspace/db": fileURLToPath(new URL("store.ts", import.meta.url)),
      "drizzle-orm": fileURLToPath(new URL("store.ts", import.meta.url)),
      "@workspace/api-zod": fileURLToPath(new URL("../../../../lib/api-zod/src/index.ts", import.meta.url)),
    },
    plugins: [{
      name: "isolated-dropbox-boundaries",
      setup(build) {
        build.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: "auth", namespace: "test" }));
        build.onLoad({ filter: /.*/, namespace: "test" }, () => ({
          contents: "export const getAuth = req => ({userId: req.headers['x-test-user']});",
        }));
        build.onResolve({ filter: /^zod(?:\/.*)?$/ }, ({ path }) => ({
          path: createRequire(new URL("../../../../lib/api-zod/package.json", import.meta.url)).resolve(path),
          external: true,
        }));
      },
    }],
  });
  const code = await new Promise((resolve, reject) => {
    // Never inherit workspace credentials or a database URL.
    const child = spawn(process.execPath, ["--test", fileURLToPath(new URL("integration.test.mjs", import.meta.url))], {
      stdio: "inherit",
      env: { PATH: process.env.PATH, SESSION_SECRET: "isolated-dropbox-test-secret", DROPBOX_TEST_BUNDLE: bundle },
    });
    child.on("error", reject);
    child.on("exit", code => resolve(code ?? 1));
  });
  process.exitCode = code;
} finally {
  await rm(directory, { recursive: true, force: true });
}
