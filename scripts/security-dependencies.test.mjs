import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const apiRequire = createRequire(path.join(root, "artifacts/api-server/package.json"));
const webRequire = createRequire(path.join(root, "artifacts/re2026/package.json"));
const canvasRequire = createRequire(path.join(root, "artifacts/mockup-sandbox/package.json"));
const proxyRequire = createRequire(apiRequire.resolve("http-proxy-middleware"));
const micromatchRequire = createRequire(proxyRequire.resolve("micromatch"));
const bracesPath = micromatchRequire.resolve("braces");
const braces = micromatchRequire("braces");

const vulnerableVersions = {
  "fast-uri": ["3.1.2"],
  nanoid: ["3.3.14"],
  esbuild: ["0.27.3"],
  orval: ["8.18.0"],
  "brace-expansion": ["2.1.1", "5.0.6"],
  multer: ["2.2.0"],
  "source-map-js": ["1.2.1"],
  qs: ["6.15.2"],
  "js-yaml": ["4.2.0"],
  "fast-copy": ["4.0.3"],
  browserslist: ["4.28.2"],
  "markdown-it": ["14.2.0"],
  postcss: ["8.5.15"],
  xlsx: ["0.18.5"],
  "linkify-it": ["5.0.1"],
  "baseline-browser-mapping": ["2.10.38"],
  braces: ["3.0.3"],
  "proxy-addr": ["2.0.7"],
  "postcss-selector-parser": ["6.0.10"],
};

// Prune before traversal, including untracked manifests and skill templates.
const excluded = new Set([
  "node_modules", ".git", "vendor", ".venv", "venv", "target", "dist",
  "build", ".next", ".cache", "dev-dist", "coverage",
]);
async function* dependencyFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory() && !excluded.has(entry.name)) {
      yield* dependencyFiles(filename);
    } else if (entry.isFile() && [
      "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
      "package-lock.json", "npm-shrinkwrap.json", "yarn.lock",
    ].includes(entry.name)) {
      yield filename;
    }
  }
}

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("no listed vulnerable package/version remains in any manifest or lockfile", async () => {
  let manifests = 0;
  let lockfiles = 0;
  for await (const filename of dependencyFiles(root)) {
    const contents = await readFile(filename, "utf8");
    if (path.basename(filename) === "package.json") {
      manifests++;
      const manifest = JSON.parse(contents);
      for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
        for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
          assert.ok(!vulnerableVersions[name]?.includes(spec.replace(/^[~^=]/, "")),
            `${path.relative(root, filename)} still pins ${name}@${spec}`);
        }
      }
    } else {
      lockfiles++;
      for (const [name, versions] of Object.entries(vulnerableVersions)) {
        for (const version of versions) {
          // Match actual pnpm package/snapshot keys, not advisory range selectors
          // or a guarded derivative with a distinct name and prerelease version.
          const pin = new RegExp(`^\\s*['"]?${escapeRegex(name)}@${escapeRegex(version)}(?:['":(\\s]|$)`, "m");
          assert.ok(!pin.test(contents), `${path.relative(root, filename)} still pins ${name}@${version}`);
        }
      }
    }
  }
  assert.ok(manifests >= 9, "workspace manifests must not be skipped");
  assert.ok(lockfiles >= 1, "lockfile must be checked");
});

test("guarded braces preserves ordinary expansion and proxy glob matching", () => {
  assert.deepEqual(braces.expand("files/{a,b}/{1..3}.pdf"), [
    "files/a/1.pdf", "files/a/2.pdf", "files/a/3.pdf",
    "files/b/1.pdf", "files/b/2.pdf", "files/b/3.pdf",
  ]);
  const micromatch = proxyRequire("micromatch");
  assert.deepEqual(micromatch(["/api/a.pdf", "/other/b.pdf"], "/api/{a,b}.pdf"), ["/api/a.pdf"]);
});

test("deep patterns and direct AST walkers reject nesting before stack exhaustion", () => {
  const result = spawnSync(process.execPath, ["-e", `
    const assert = require("node:assert/strict");
    const braces = require(${JSON.stringify(bracesPath)});
    const pattern = "{".repeat(4000) + "a,b" + "}".repeat(4000);
    const guarded = error => /(?:max depth|depth.*exceed)/i.test(error.message)
      && !/Maximum call stack/.test(error.message);
    for (const operation of ["parse", "compile", "expand", "stringify"]) {
      assert.throws(() => braces[operation](pattern), guarded, operation);
    }
    const ast = { type: "root", nodes: [] };
    let parent = ast;
    for (let i = 0; i < 150; i++) {
      const child = { type: "brace", nodes: [], parent };
      parent.nodes.push(child);
      parent = child;
    }
    parent.nodes.push({ type: "text", value: "a" });
    for (const operation of ["compile", "expand", "stringify"]) {
      assert.throws(() => braces[operation](ast), guarded, operation + " AST");
    }
  `], { timeout: 10000, encoding: "utf8" });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});

test("fast-glob still discovers nested mockup components", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "security-glob-"));
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(directory, "nested"));
    await writeFile(path.join(directory, "nested", "Card.tsx"), "");
    await writeFile(path.join(directory, "nested", "_Hidden.tsx"), "");
    const glob = canvasRequire("fast-glob");
    assert.deepEqual(await glob("**/*.{tsx,jsx}", {
      cwd: directory, ignore: ["**/_*/**", "**/_*.tsx"],
    }), ["nested/Card.tsx"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Excel exports preserve invoice and position values, widths, headers and frozen rows", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "security-excel-"));
  try {
    // Bundle the real export helpers. Resolve libraries from their owning packages,
    // and use the equivalent Node writer to inspect the actual XLSX archive.
    const { build } = apiRequire("esbuild");
    const writerPath = webRequire.resolve("write-excel-file/node");
    await build({
      entryPoints: [path.join(root, "artifacts/re2026/src/lib/xlsx-export.ts")],
      outfile: path.join(directory, "exports.mjs"),
      bundle: true, platform: "node", format: "esm",
      plugins: [{
        name: "node-excel-writer",
        setup(build) {
          build.onResolve({ filter: /^write-excel-file\/browser$/ }, () => ({
            path: writerPath, external: true,
          }));
        },
      }],
    });
    const exports = await import(pathToFileURL(path.join(directory, "exports.mjs")).href);
    const invoice = {
      dateiname: "test.pdf", rechnungssteller: "Müller", bruttoBetrag: 119.95,
      nettoBetrag: 100.80, steuerBetrag: 19.15, steuersatz: 19,
      waehrung: "EUR", freifeld1: "=HYPERLINK(\"https://example.com\")",
      positionen: [{ beschreibung: "Leistung", menge: 0, einzelpreis: 100.80 }],
    };
    const writeExcelFile = webRequire("write-excel-file/node");
    const { unzipSync, strFromU8 } = createRequire(writerPath)("fflate");
    for (const sheet of [
      exports.createInvoiceExcelSheet([invoice]),
      exports.createPositionExcelSheet([invoice]),
    ]) {
      const buffer = await writeExcelFile(sheet.data, sheet.options).toBuffer();
      const files = unzipSync(buffer);
      const xml = strFromU8(files["xl/worksheets/sheet1.xml"]);
      const strings = strFromU8(files["xl/sharedStrings.xml"]);
      assert.match(strings, /Rechnungssteller/);
      assert.match(strings, /Müller/);
      assert.match(strings, /EUR/);
      assert.match(xml, /state="frozen"/);
      assert.match(xml, /ySplit="1"/);
      assert.match(xml, new RegExp(`width="${sheet.options.columns[0].width}"`));
      assert.match(strFromU8(files["xl/workbook.xml"]), new RegExp(sheet.options.sheet));
    }
    const sheet = exports.createInvoiceExcelSheet([invoice]);
    assert.equal(sheet.data[1][4].value, 119.95);
    assert.equal(sheet.data[1][4].type, Number);
    assert.equal(sheet.data[1][11].type, String);
    const buffer = await writeExcelFile(sheet.data, sheet.options).toBuffer();
    assert.doesNotMatch(strFromU8(unzipSync(buffer)["xl/worksheets/sheet1.xml"]), /<f[ >]/);
    assert.equal(exports.createPositionExcelSheet([invoice]).data[1][6].value, 0);
    assert.equal(exports.createPositionExcelSheet([invoice]).count, 1);
    assert.equal(exports.createInvoiceExcelSheet([]).data[0].length, 14);
    assert.equal(await exports.exportInvoicePositionsToXLSX([]), 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
