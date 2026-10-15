import test from "node:test";
import assert from "node:assert/strict";
import { scanDropboxPDFs, planDropboxBatch, type DropboxEntry } from "./dropbox-scan";

const file = (id: number, path = `/Haupt/2026/01/${id}.PDF`): DropboxEntry => ({
  ".tag": "file", name: path.split("/").at(-1)!, id: String(id), path_display: path, path_lower: path.toLowerCase(),
});
test("Dropbox scan requests all descendants and consumes continuation pages", async () => {
  const requests: Array<[string, unknown]> = [];
  const pages = [
    { entries: [file(1, "/Haupt/1.pdf"), file(2)], has_more: true, cursor: "next" },
    { entries: [file(3, "/Haupt/2026/01/Unterordner/3.pdf"), file(4, "/Haupt/image.jpg"), file(2)], has_more: false, cursor: "last" },
  ];
  const files = await scanDropboxPDFs("/Haupt", async (endpoint, body) => {
    requests.push([endpoint, body]);
    return Response.json(pages.shift());
  });
  assert.deepEqual(requests, [
    ["/2/files/list_folder", { path: "/Haupt", recursive: true }],
    ["/2/files/list_folder/continue", { cursor: "next" }],
  ]);
  assert.deepEqual(files.map(f => f.id), ["1", "2", "3"]);
});
test("pagination errors fail explicitly rather than returning incomplete scan", async () => {
  let call = 0;
  await assert.rejects(scanDropboxPDFs("/Haupt", async () => ++call === 1
    ? Response.json({ entries: [file(1)], has_more: true, cursor: "next" })
    : new Response("", { status: 503 })), /503/);
});
test("more than 100 PDFs do not block import; later batches skip successfully imported files", () => {
  const files = Array.from({ length: 250 }, (_, i) => file(i));
  const existing = new Set<string>();
  const first = planDropboxBatch(files, existing, 100);
  assert.equal(first.files.length, 100);
  assert.equal(first.remaining, 150);
  first.files.forEach(f => existing.add(f.id));
  const second = planDropboxBatch(files, existing, 100);
  assert.equal(second.skipped, 100);
  assert.equal(second.remaining, 50);
  assert.equal(second.files[0].id, "100");
  second.files.forEach(f => existing.add(f.id));
  const third = planDropboxBatch(files, existing, 100);
  assert.equal(third.files.length, 50);
  assert.equal(third.remaining, 0);
});
