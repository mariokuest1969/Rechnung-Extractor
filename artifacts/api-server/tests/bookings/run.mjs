import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const dir = await mkdtemp(fileURLToPath(new URL(".booking-tests-", root)));
try {
  await build({
    entryPoints: [fileURLToPath(new URL("routes.test.ts", import.meta.url))],
    outfile: `${dir}/tests.mjs`, bundle: true, platform: "node", format: "esm",
    packages: "external",
    alias: {
      "@workspace/invoice-tax": fileURLToPath(new URL("../../../../lib/invoice-tax/src/index.ts", import.meta.url)),
      "@workspace/db": fileURLToPath(new URL("store.ts", import.meta.url)),
      "@workspace/api-zod": fileURLToPath(new URL("../../../../lib/api-zod/src/index.ts", import.meta.url)),
    },
    plugins: [{
      name: "booking-test-dependencies",
      setup(build) {
        build.onResolve({ filter: /^(pg|drizzle-zod|zod(?:\/.*)?)$/ }, ({ path }) => ({
          path: createRequire(new URL("../../../../lib/db/package.json", import.meta.url)).resolve(path),
          external: true,
        }));
      },
    }],
  });
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--test", `${dir}/tests.mjs`], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", code => resolve(code ?? 1));
  });
} finally {
  await rm(dir, { recursive: true, force: true });
}
