import { build } from "esbuild";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const dir = await mkdtemp(fileURLToPath(new URL(".invoice-tests-", root)));
try {
  await build({
    entryPoints: [fileURLToPath(new URL("routes.test.ts", import.meta.url))],
    outfile: `${dir}/tests.mjs`, bundle: true, platform: "node", format: "esm",
    packages: "external",
    alias: {
      "@workspace/db": fileURLToPath(new URL("store.ts", import.meta.url)),
      "@workspace/api-zod": fileURLToPath(new URL("../../../../lib/api-zod/src/index.ts", import.meta.url)),
    },
    plugins: [{
      name: "invoice-test-boundaries",
      setup(build) {
        // Exercise the actual route deadline without making the suite wait 70 seconds.
        build.onLoad({ filter: /\/preview-deadline\.ts$/ }, async ({ path }) => ({
          contents: (await readFile(path, "utf8")).replace("70_000", "40"),
          loader: "ts",
        }));
        build.onResolve({ filter: /^(pg|drizzle-zod|zod(?:\/.*)?)$/ }, ({ path }) => ({
          path: createRequire(new URL("../../../../lib/db/package.json", import.meta.url)).resolve(path),
          external: true,
        }));
        build.onResolve({ filter: /\/(pdf-extractor|dropbox-poller|reextract-jobs|settings)$/ }, ({ path }) =>
          path.includes("/schema/") ? undefined : ({ path, namespace: "test-boundary" }));
        build.onLoad({ filter: /.*/, namespace: "test-boundary" }, ({ path }) => ({
          contents: path.endsWith("pdf-extractor")
            ? `export async function extractInvoiceFromPDF(buffer, name, dependencies, signal) {
                if (buffer.toString() === "%PDF-hang") return new Promise(() => {});
                if (!buffer.toString().startsWith("%PDF-")) throw new Error("Invalid PDF");
                return { rechnungssteller: "PDF supplier", bruttoBetrag: 119, nettoBetrag: 100,
                  steuerBetrag: 19, steuersatz: 19, positionen: [{ beschreibung: "PDF position", menge: 1 }] };
              }`
            : `export const syncDropbox = async () => {};
               export const cleanupDropbox = async () => {};
               export const downloadDropboxFile = async () => {};
               export const dropboxPost = async () => {};
               export const getDropboxToken = async () => {};
               export const createReextractJob = async () => {};
               export const readReextractJob = async () => {};
               export const commitReextractJob = async () => {};
               export const failReextractJob = async () => {};`,
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
