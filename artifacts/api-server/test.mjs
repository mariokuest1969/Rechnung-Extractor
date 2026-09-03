import { cp, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { build } from "esbuild";

const outputDirectory = new URL("./.test-dist/", import.meta.url);
const outputFile = new URL("pdf-extractor.test.mjs", outputDirectory);

await rm(outputDirectory, { force: true, recursive: true });
await build({
  bundle: true,
  entryPoints: [new URL("./src/lib/pdf-extractor.test.ts", import.meta.url).pathname],
  format: "esm",
  outfile: outputFile.pathname,
  packages: "external",
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
    ["--enable-source-maps", "--test", outputFile.pathname],
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