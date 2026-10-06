import { cp, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import { createRequire } from "node:module";

const outputDirectory = new URL("./.test-dist/", import.meta.url);
const outputFile = new URL("tests.mjs", outputDirectory);

await rm(outputDirectory, { force: true, recursive: true });
await build({
  bundle: true,
  entryPoints: [new URL("./test-entry.ts", import.meta.url).pathname],
  format: "esm",
  outfile: outputFile.pathname,
  packages: "external",
  alias: { "@workspace/db": new URL("../../lib/db/src/index.ts", import.meta.url).pathname },
  plugins: [{
    name: "db-runtime-dependencies",
    setup(build) {
      build.onResolve({ filter: /^(pg|drizzle-zod)$/ }, ({ path }) => ({
        path: createRequire(new URL("../../lib/db/package.json", import.meta.url)).resolve(path),
        external: true,
      }));
    },
  }],
  platform: "node",
  sourcemap: "inline",
  target: "node24",
});
await mkdir(new URL("__fixtures__/", outputDirectory), { recursive: true });
await cp(
  new URL(
    "./src/lib/__fixtures__/mixed-text-and-image.pdf.base64",
    import.meta.url
  ),
  new URL("__fixtures__/mixed-text-and-image.pdf.base64", outputDirectory)
);

const result = await new Promise((resolve, reject) => {
  const child = spawn(
    process.execPath,
    [
      "--enable-source-maps",
      "--test",
      outputFile.pathname,
    ],
    { stdio: "inherit" }
  );
  child.on("error", reject);
  child.on("exit", (code, signal) => resolve({ code, signal }));
});

await rm(outputDirectory, { force: true, recursive: true });

if (result.signal) {
  process.kill(process.pid, result.signal);
} else {
  process.exitCode = result.code ?? 1;
}