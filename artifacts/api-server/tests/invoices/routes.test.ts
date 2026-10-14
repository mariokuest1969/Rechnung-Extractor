import assert from "node:assert/strict";
import { test, after } from "node:test";
import { once } from "node:events";
import express from "express";
import router from "../../src/routes/invoices";
import { client } from "./store";
import { ExtractPreviewResponse } from "@workspace/api-zod";
import { extractPreviews } from "../../../re2026/src/lib/upload-preview";
import { parseInvoiceId, parseInvoiceIds } from "../../src/lib/invoice-ids";

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.log = { error() {} } as any; next(); });
app.use(router);
app.use((err: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(err.status ?? 500).json({ error: "Request failed" });
});
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address() as { port: number };
const url = `http://127.0.0.1:${address.port}/invoices`;
after(async () => { server.close(); await client.end(); });
async function request(path = "", method = "GET", body?: unknown) {
  const response = await fetch(url + path, {
    method, headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}
async function upload(files: { content: string; type?: string }[], path = "/upload") {
  const form = new FormData();
  for (const file of files) form.append("files", new Blob([file.content], { type: file.type ?? "application/pdf" }), "invoice.pdf");
  const response = await fetch(url + path, { method: "POST", body: form });
  return { status: response.status, body: await response.json() };
}

test("invoice routes preserve existing data and atomically save validated uploads", async () => {
  assert.deepEqual((await request()).body, []);
  assert.equal((await request("/stats")).body.totalInvoices, 0);
  const confirmed = await request("/upload-confirmed", "POST", [{
    dateiname: "reviewed.pdf", rechnungssteller: "Reviewed supplier", bruttoBetrag: 238,
    nettoBetrag: 200, steuerBetrag: 38, steuersatz: 19, freifeld1: "keep",
    buchungskonto1Betrag: 0, positionen: [{ beschreibung: "Reviewed position", menge: 2 }],
    id: 999, dropboxFileId: "must-not-be-accepted",
  }]);
  assert.equal(confirmed.status, 200);
  const original = confirmed.body[0];
  assert.notEqual(original.id, 999);
  assert.equal(original.dropboxFileId, null);
  assert.equal(original.bruttoBetrag, 238);
  assert.equal(original.buchungskonto1Betrag, 0);
  assert.equal(original.positionen[0].menge, 2);
  assert.equal(original.freifeld1, "keep");
  assert.ok(original.createdAt);
  assert.deepEqual((await request(`/${original.id}`)).body, original);
  assert.deepEqual((await request(`/${original.id}`)).body, original);
  for (const id of ["0", "-1", "1abc", "1.2"]) assert.equal((await request(`/${id}`)).status, 400);
  assert.equal((await request("/999999")).status, 404);

  const pdf = await upload([{ content: "%PDF-1.7 test fixture" }]);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.body[0].bruttoBetrag, 119);
  assert.equal(pdf.body[0].dateiname, "invoice.pdf");
  assert.equal(pdf.body[0].positionen[0].beschreibung, "PDF position");
  const before = (await request()).body;
  assert.equal(before.length, 2);
  // Same filename must not collapse results. A failed preview has no invoice data.
  const mixed = await upload([{ content: "%PDF-valid" }, { content: "broken" }, { content: "%PDF-valid" }], "/extract-preview");
  assert.equal(mixed.status, 200);
  assert.equal(ExtractPreviewResponse.safeParse(mixed.body).success, true);
  assert.deepEqual(mixed.body.map((p: any) => p.status), ["success", "error", "success"]);
  assert.equal(mixed.body[0].bruttoBetrag, 119);
  assert.equal(mixed.body[2].error, null);
  assert.deepEqual(Object.keys(mixed.body[1]).sort(), ["dateiname", "error", "status"]);
  assert.ok(mixed.body[1].error.includes("PDF"));
  assert.equal((await request("/upload-confirmed", "POST", mixed.body)).status, 400);
  assert.deepEqual((await request()).body, before);
  const failed = await upload([{ content: "broken" }, { content: "broken" }], "/extract-preview");
  assert.deepEqual(failed.body.map((p: any) => p.status), ["error", "error"]);
  const retried = await upload([{ content: "%PDF-valid" }], "/extract-preview");
  assert.equal(retried.body[0].status, "success");
  assert.equal((await upload([], "/extract-preview")).status, 400);
  assert.deepEqual((await request()).body, before);
  assert.deepEqual(before.find((r: any) => r.id === original.id), original);
  assert.deepEqual((await request("/stats")).body, {
    totalInvoices: 2, totalBrutto: 357, totalNetto: 300, totalSteuer: 57,
    byWaehrung: [{ waehrung: "EUR", totalBrutto: 357, count: 2 }],
  });

  for (const body of [null, {}, [], [{}], [{ dateiname: 4 }], [
    { dateiname: "valid.pdf" }, { dateiname: "invalid.pdf", bruttoBetrag: "bad" },
  ], [{ dateiname: "bad.pdf", positionen: [{}] }]]) {
    assert.equal((await request("/upload-confirmed", "POST", body)).status, 400);
    assert.deepEqual((await request()).body, before);
  }
  assert.equal((await upload([])).status, 400);
  assert.equal((await upload([{ content: "text", type: "text/plain" }])).status, 400);
  assert.equal((await upload([{ content: "%PDF-valid" }, { content: "broken" }])).status, 422);
  assert.deepEqual((await request()).body, before);
  // A database failure in the second row must roll back the entire batch.
  assert.equal((await request("/upload-confirmed", "POST", [
    { dateiname: "valid.pdf", bruttoBetrag: 10 },
    { dateiname: "overflow.pdf", bruttoBetrag: 1e15 },
  ])).status, 500);
  assert.deepEqual((await request()).body, before);
  const batch = await request("/upload-confirmed", "POST", [
    { dateiname: "minimal.pdf" },
    { dateiname: "zero.pdf", bruttoBetrag: 0, waehrung: null },
  ]);
  assert.equal(batch.status, 200);
  assert.equal(batch.body.length, 2);
  assert.equal(batch.body[0].bruttoBetrag, null);
  assert.deepEqual(batch.body[0].positionen, []);
  assert.equal(batch.body[1].bruttoBetrag, 0);
  assert.equal(batch.body[1].waehrung, "EUR");
  for (const row of batch.body) assert.equal((await request(`/${row.id}`, "DELETE")).status, 204);

  const edited = await request(`/${original.id}`, "PATCH", { bemerkung: "Edited", bruttoBetrag: 0 });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.bruttoBetrag, 0);
  assert.equal((await request()).body.length, 2);
  assert.equal((await request(`/${original.id}`)).body.bemerkung, "Edited");
  assert.equal((await request(`/${original.id}`, "DELETE")).status, 204);
  assert.equal((await request()).body.length, 1);
});

test("invalid invoice IDs reject entire requests without changing invoices", async () => {
  const created = await request("/upload-confirmed", "POST", [
    { dateiname: "ids-a.pdf", bruttoBetrag: 119 },
    { dateiname: "ids-b.pdf", bruttoBetrag: 238 },
  ]);
  const [a, b] = created.body;
  const before = (await request()).body;
  const invalid = [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, true, false, {}, [],
    "", " ", `${a.id}abc`, `${a.id}.5`, "1e0", "0x1", "+1", "9007199254740993"];
  for (const value of [...invalid, undefined, NaN, Infinity, -Infinity]) {
    assert.equal(parseInvoiceId(value), null);
    assert.equal(parseInvoiceIds([a.id, value]), null);
  }
  assert.equal(parseInvoiceId(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  assert.equal(parseInvoiceId(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  for (const ids of [[], null, {}, "1", ...invalid.map(value => [a.id, value, b.id])]) {
    for (const fields of [{ freifeld1: "must not change" }, { steuersatz: 7 }]) {
      assert.equal((await request("/bulk-update", "PATCH", { ids, fields })).status, 400);
      assert.deepEqual((await request()).body, before);
    }
    assert.equal((await request("/bulk-delete", "POST", { ids })).status, 400);
    assert.deepEqual((await request()).body, before);
  }
  for (const body of [undefined, null, {}, []]) {
    assert.equal((await request("/bulk-update", "PATCH", body)).status, 400);
    assert.equal((await request("/bulk-delete", "POST", body)).status, 400);
  }
  for (const value of ["0", "-1", "1.5", `${a.id}abc`, "9007199254740993", "NaN", "Infinity"]) {
    for (const [method, suffix] of [["GET", ""], ["PATCH", ""], ["DELETE", ""],
      ["GET", "/pdf"], ["GET", "/dropbox-link"], ["POST", "/reextract"]]) {
      assert.equal((await request(`/${value}${suffix}`, method, method === "PATCH" ? { freifeld1: "bad" } : undefined)).status, 400);
      assert.deepEqual((await request()).body, before);
    }
  }

  // Duplicates and nonexistent IDs must not inflate the affected-row counts.
  const ids = [a.id, String(a.id), b.id, 999999];
  const changed = await request("/bulk-update", "PATCH", { ids, fields: { freifeld1: "valid" } });
  assert.equal(changed.status, 200);
  assert.deepEqual(changed.body, { updated: 2 });
  assert.equal((await request(`/${a.id}`)).body.freifeld1, "valid");
  const taxed = await request("/bulk-update", "PATCH", { ids, fields: { steuersatz: 19 } });
  assert.equal(taxed.status, 200);
  assert.deepEqual(taxed.body, { updated: 2 });
  assert.equal((await request(`/${a.id}`)).body.nettoBetrag, 100);
  assert.equal((await request(`/${b.id}`)).body.nettoBetrag, 200);
  for (const fields of [{ freifeld1: "missing" }, { steuersatz: 7 }]) {
    assert.deepEqual((await request("/bulk-update", "PATCH", { ids: [999999], fields })).body, { updated: 0 });
  }
  assert.equal((await request("/999999", "DELETE")).status, 404);
  assert.equal((await request("/999999/pdf")).status, 404);
  assert.equal((await request("/999999/dropbox-link")).status, 404);
  assert.deepEqual((await request("/bulk-delete", "POST", { ids })).body, { deleted: 2 });
  assert.deepEqual((await request("/bulk-delete", "POST", { ids })).body, { deleted: 0 });
  assert.equal((await request(`/${a.id}`)).status, 404);
  assert.equal((await request(`/${b.id}`)).status, 404);
});

test("preview client turns transport and malformed responses into per-file errors", async () => {
  const originalFetch = globalThis.fetch;
  const files = [new File(["first"], "same.pdf"), new File(["second"], "same.pdf")];
  try {
    for (const response of [
      new Response("unavailable", { status: 503 }),
      Response.json([]),
      Response.json([{ dateiname: "same.pdf" }, { dateiname: "same.pdf" }]),
      new Response("not json"),
    ]) {
      globalThis.fetch = async () => response;
      const result = await extractPreviews(files);
      assert.equal(result.length, 2);
      assert.ok(result.every(p => p.status === "error" && p.error));
    }
    globalThis.fetch = async () => { throw new TypeError("Network unavailable"); };
    assert.ok((await extractPreviews(files)).every(p => p.status === "error"));
    const expected = [
      { dateiname: "same.pdf", status: "success", error: null, bruttoBetrag: 119 },
      { dateiname: "same.pdf", status: "error", error: "Bitte erneut versuchen" },
    ];
    globalThis.fetch = async (_url, options) => {
      assert.equal((options?.body as FormData).getAll("files").length, 2);
      return Response.json(expected);
    };
    assert.deepEqual(await extractPreviews(files), expected);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
