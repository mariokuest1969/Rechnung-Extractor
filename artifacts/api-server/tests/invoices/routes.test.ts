import assert from "node:assert/strict";
import { test, after, mock } from "node:test";
import { once } from "node:events";
import express from "express";
import router from "../../src/routes/invoices";
import { client, db } from "./store";
import { ExtractPreviewResponse, BulkUpdateInvoicesBody } from "@workspace/api-zod";
import { extractPreviews } from "../../../re2026/src/lib/upload-preview";
import { parseInvoiceId, parseInvoiceIds } from "../../src/lib/invoice-ids";
import { previewDeadline } from "../../src/lib/preview-deadline";

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.log = { error() {} } as any; next(); });
app.use(router);
app.use((err: { status?: number; message?: string; cause?: { message?: string } }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(err.status ?? 500).json({ error: err.cause?.message ?? err.message ?? "Request failed" });
});
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address() as { port: number };
const url = `http://127.0.0.1:${address.port}/invoices`;
async function duplicateRequest(path = "", ids?: number[]) {
  const response = await fetch(`http://127.0.0.1:${address.port}/invoice-duplicates${path}`, {
    method: ids ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: ids ? JSON.stringify({ ids }) : undefined,
  });
  return { status: response.status, body: await response.json() };
}
after(async () => { server.close(); await client.end(); });
test("duplicate review and deletion retain originals and atomically suppress Dropbox reimport", async () => {
  const { rows } = await client.query(`
    INSERT INTO invoices (rechnungssteller,rechnungsnummer,datum,brutto_betrag,waehrung,dropbox_file_id)
    VALUES ('Duplicate test','DUP-TEST','2026-02-01',119,'EUR','test-dup-keep'),
           ('Duplicate test','DUP-TEST','2026-02-01',119,'EUR','test-dup-remove')
    RETURNING id
  `);
  const [keep, remove] = rows.map(row => row.id);
  const report = await duplicateRequest();
  assert.equal(report.status, 200, JSON.stringify(report.body));
  assert.ok(report.body.groups.some((g: { invoices: { id: number }[] }) => g.invoices.some(i => i.id === keep)));
  assert.equal((await duplicateRequest("/delete", [keep, remove])).status, 409);
  assert.equal((await duplicateRequest("/delete", [remove, 99999999])).status, 409);
  assert.equal((await duplicateRequest("/delete", [remove, remove])).status, 400);
  assert.equal((await client.query("SELECT count(*) FROM settings WHERE key LIKE 'dropbox_duplicate_excluded:%'")).rows[0].count, "0");
  // A failing DELETE must roll back the exclusion inserted earlier in the same transaction.
  await client.query(`CREATE FUNCTION pg_temp.fail_duplicate_delete() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'test failure'; END $$`);
  await client.query(`CREATE TRIGGER fail_duplicate_delete BEFORE DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_duplicate_delete()`);
  assert.equal((await duplicateRequest("/delete", [remove])).status, 500);
  assert.equal((await client.query("SELECT count(*) FROM settings")).rows[0].count, "0");
  await client.query("DROP TRIGGER fail_duplicate_delete ON invoices");
  const deleted = await duplicateRequest("/delete", [remove]);
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  assert.equal(deleted.body.deleted, 1);
  assert.equal((await client.query("SELECT id FROM invoices WHERE id=$1", [keep])).rowCount, 1);
  assert.equal((await client.query("SELECT id FROM invoices WHERE id=$1", [remove])).rowCount, 0);
  assert.equal((await client.query("SELECT key FROM settings WHERE key=$1", ["dropbox_duplicate_excluded:test-dup-remove"])).rowCount, 1);
  assert.equal((await duplicateRequest("/delete", [remove])).status, 409);
  // Leave other route tests' initial empty state untouched.
  await client.query("DELETE FROM invoices WHERE id=$1", [keep]);
  await client.query("DELETE FROM settings");
});
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

test("bulk tax updates roll back every field when a later invoice fails", async () => {
  const created = await request("/upload-confirmed", "POST", [
    { dateiname: "atomic-a.pdf", bruttoBetrag: 119, nettoBetrag: 100, steuerBetrag: 19,
      steuersatz: 19, freifeld1: "original-a", buchungskonto1Betrag: 10 },
    { dateiname: "atomic-b.pdf", bruttoBetrag: 238, nettoBetrag: 200, steuerBetrag: 38,
      steuersatz: 19, freifeld1: "original-b", buchungskonto1Betrag: 20 },
    { dateiname: "atomic-null.pdf", freifeld1: "original-null" },
  ]);
  assert.equal(created.status, 200);
  const ids = created.body.map((row: { id: number }) => row.id);
  const snapshot = async () => (await client.query("SELECT * FROM pg_temp.invoices ORDER BY id")).rows;
  const before = await snapshot();
  // Sequence increments survive rollback: prove a real first UPDATE succeeded
  // before the second UPDATE fails, independently of SELECT row ordering.
  await client.query(`
    CREATE TEMP SEQUENCE bulk_tax_attempts;
    CREATE FUNCTION pg_temp.fail_second_tax_update() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF nextval('pg_temp.bulk_tax_attempts') = 2 THEN
        RAISE EXCEPTION 'Intentional later invoice failure';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER fail_second_tax_update BEFORE UPDATE ON pg_temp.invoices
      FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_second_tax_update();
  `);
  try {
    const result = await request("/bulk-update", "PATCH", {
      ids, fields: { steuersatz: 7, freifeld1: "changed", buchungskonto1Betrag: 42 },
    });
    assert.equal(result.status, 500);
    assert.equal((await client.query("SELECT last_value FROM pg_temp.bulk_tax_attempts")).rows[0].last_value, "2");
    assert.deepEqual(await snapshot(), before);
  } finally {
    await client.query(`
      DROP TRIGGER fail_second_tax_update ON pg_temp.invoices;
      DROP FUNCTION pg_temp.fail_second_tax_update();
      DROP SEQUENCE pg_temp.bulk_tax_attempts;
    `);
  }
  // The same connection remains usable and success commits all selected rows.
  const result = await request("/bulk-update", "PATCH", {
    ids, fields: { steuersatz: 0, freifeld1: "committed", buchungskonto1Betrag: 42 },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { updated: 3 });
  for (const original of created.body) {
    const saved = (await request(`/${original.id}`)).body;
    assert.equal(saved.steuersatz, 0);
    assert.equal(saved.nettoBetrag, original.bruttoBetrag);
    assert.equal(saved.steuerBetrag, original.bruttoBetrag === null ? null : 0);
    assert.equal(saved.freifeld1, "committed");
    assert.equal(saved.buchungskonto1Betrag, 42);
  }
  await request("/bulk-delete", "POST", { ids });
});

test("single invoice updates reject invalid tax and booking values without changing data", async () => {
  const created = await request("/upload-confirmed", "POST", [{
    dateiname: "single-validation.pdf", steuersatz: 19,
    buchungskonto1Betrag: 10, buchungskonto2Betrag: -10, freifeld1: "original",
  }]);
  assert.equal(created.status, 200);
  const original = created.body[0];
  const path = `/${original.id}`;
  try {
    for (const key of ["steuersatz", "buchungskonto1Betrag", "buchungskonto2Betrag"]) {
      const invalid = ["19", "", true, [], {}, 1.001, 1e-7, -1e-7,
        ...(key === "steuersatz" ? [-0.01, 100.01] : [-10000000000, 10000000000])];
      for (const value of invalid) {
        const result = await request(path, "PATCH", { [key]: value, freifeld1: "must not change" });
        assert.equal(result.status, 400, `${key}=${JSON.stringify(value)}`);
        assert.deepEqual((await request(path)).body, original);
      }
      // Send overflow as JSON numbers: JSON.stringify(Infinity) would instead send null.
      for (const value of ["1e400", "-1e400"]) {
        const result = await fetch(url + path, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: `{"${key}":${value},"freifeld1":"must not change"}`,
        });
        assert.equal(result.status, 400);
        assert.deepEqual((await request(path)).body, original);
      }
    }
    for (const rate of [0, 7.25, 100]) {
      const values = { steuersatz: rate, buchungskonto1Betrag: -9999999999.99,
        buchungskonto2Betrag: 9999999999.99 };
      assert.equal((await request(path, "PATCH", values)).status, 200);
      const saved = (await request(path)).body;
      for (const [key, value] of Object.entries(values)) assert.equal(saved[key], value);
      assert.equal(saved.freifeld1, "original");
    }
    for (const value of [-12.34, 0, null]) {
      const values = { steuersatz: value === null ? null : 19,
        buchungskonto1Betrag: value, buchungskonto2Betrag: value };
      assert.equal((await request(path, "PATCH", values)).status, 200);
      const saved = (await request(path)).body;
      for (const [key, expected] of Object.entries(values)) assert.equal(saved[key], expected);
    }
    assert.equal((await request(path, "PATCH", { freifeld1: "only text" })).status, 200);
    const saved = (await request(path)).body;
    assert.equal(saved.steuersatz, null);
    assert.equal(saved.buchungskonto1Betrag, null);
    assert.equal(saved.buchungskonto2Betrag, null);
  } finally {
    await request(path, "DELETE");
  }
});

test("bulk field validation rejects the whole request before database access", async () => {
  const created = await request("/upload-confirmed", "POST", [
    { dateiname: "fields-a.pdf", bruttoBetrag: 119, freifeld1: "keep" },
    { dateiname: "fields-b.pdf", bruttoBetrag: 238, freifeld1: "keep" },
  ]);
  assert.equal(created.status, 200);
  const ids = created.body.map((row: any) => row.id);
  const before = (await request()).body;
  const invalidFields: unknown[] = [undefined, null, [], "", 42, true, {}, { steuersatz: null },
    { freifeld1: "changed", unknown: "unsupported" }];
  for (const key of ["rechnungssteller", "buchungskonto1", "buchungskonto2", "buchungstext",
    "freifeld1", "freifeld2", "freifeld3"]) {
    for (const value of [42, true, {}, []]) invalidFields.push({ freifeld1: "changed", [key]: value });
  }
  for (const key of ["steuersatz", "buchungskonto1Betrag", "buchungskonto2Betrag", "lieferantId"]) {
    for (const value of ["19", "", " ", "NaN", "Infinity", true, false, {}, []]) {
      invalidFields.push({ freifeld1: "changed", [key]: value });
    }
    // JSON.stringify maps nonfinite numbers to null; test the actual schema as well.
    for (const value of [NaN, Infinity, -Infinity]) {
      assert.equal(BulkUpdateInvoicesBody.shape.fields.safeParse({ [key]: value }).success, false);
    }
  }
  for (const value of [-100, -1, 100.01, 1e100, 0.001, 19.999, 1e-7]) {
    invalidFields.push({ steuersatz: value, freifeld1: "changed" });
  }
  for (const value of [0, -1, 1.5, 2147483648]) invalidFields.push({ lieferantId: value, freifeld1: "changed" });
  for (const key of ["buchungskonto1Betrag", "buchungskonto2Betrag"]) {
    for (const value of [-1e10, 1e10, 1e100, 0.001, -12.345, 1e-7]) {
      invalidFields.push({ [key]: value, steuersatz: 19 });
    }
  }
  const select = mock.method(db, "select");
  const update = mock.method(db, "update");
  try {
    for (const fields of invalidFields) {
      assert.equal((await request("/bulk-update", "PATCH", { ids, fields })).status, 400,
        JSON.stringify(fields));
    }
    // Legal JSON number syntax can overflow JavaScript's finite number range.
    for (const key of ["steuersatz", "buchungskonto1Betrag", "buchungskonto2Betrag"]) {
      const response = await fetch(url + "/bulk-update", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: `{"ids":${JSON.stringify(ids)},"fields":{"${key}":1e400,"freifeld1":"changed"}}`,
      });
      assert.equal(response.status, 400);
    }
    assert.equal(select.mock.callCount(), 0);
    assert.equal(update.mock.callCount(), 0);
  } finally {
    select.mock.restore();
    update.mock.restore();
  }
  assert.deepEqual((await request()).body, before);

  for (const rate of [0, 0.01, 7, 19, 19.99, 20.5, 100]) {
    const result = await request("/bulk-update", "PATCH", { ids, fields: {
      steuersatz: rate, buchungskonto1Betrag: -9999999999.99,
      buchungskonto2Betrag: 9999999999.99, lieferantId: 2147483647,
      rechnungssteller: "", buchungskonto1: "", buchungskonto2: null,
      buchungstext: "valid", freifeld1: null, freifeld2: "", freifeld3: "valid",
    } });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { updated: 2 });
    const row = (await request(`/${ids[0]}`)).body;
    assert.equal(row.steuersatz, rate);
    assert.equal(row.nettoBetrag, Math.round(119 / (1 + rate / 100) * 100) / 100);
    assert.equal(row.buchungskonto1Betrag, -9999999999.99);
    assert.equal(row.buchungskonto2Betrag, 9999999999.99);
    assert.equal(row.freifeld1, null);
    assert.equal(row.rechnungssteller, "");
  }
  const cleared = await request("/bulk-update", "PATCH", { ids, fields: {
    buchungskonto1Betrag: null, buchungskonto2Betrag: 0, lieferantId: null, steuersatz: null,
  } });
  assert.equal(cleared.status, 200);
  const row = (await request(`/${ids[0]}`)).body;
  assert.equal(row.buchungskonto1Betrag, null);
  assert.equal(row.buchungskonto2Betrag, 0);
  assert.equal(row.lieferantId, null);
  assert.equal(row.steuersatz, 100); // Preserve the existing null-rate no-op semantics.
  await request("/bulk-delete", "POST", { ids });
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
    let index = 0;
    globalThis.fetch = async (_url, options) => {
      assert.equal((options?.body as FormData).getAll("files").length, 1);
      return Response.json([expected[index++]]);
    };
    assert.deepEqual(await extractPreviews(files), expected);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preview route retains success, bounds a hung extractor and permits retry without saving", async () => {
  const before = (await request()).body;
  const result = await upload([
    { content: "%PDF-valid" }, { content: "%PDF-hang" }, { content: "%PDF-valid" },
  ], "/extract-preview");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.map((p: any) => p.status), ["success", "error", "error"]);
  assert.match(result.body[1].error, /Zeitüberschreitung/);
  assert.equal(ExtractPreviewResponse.safeParse(result.body).success, true);
  const retry = await upload([{ content: "%PDF-valid" }], "/extract-preview");
  assert.equal(retry.body[0].status, "success");
  assert.deepEqual((await request()).body, before);
});

test("preview deadline aborts cooperative work and ignores late results", async () => {
  const deadline = previewDeadline(undefined, 10);
  let finish!: (value: string) => void;
  try {
    const pending = deadline.run(() => new Promise<string>(resolve => { finish = resolve; }));
    await assert.rejects(pending, /Zeitüberschreitung/);
    assert.equal(deadline.signal.aborted, true);
    finish("too late");
    let called = false;
    await assert.rejects(deadline.run(async () => { called = true; }), /Zeitüberschreitung/);
    assert.equal(called, false);
  } finally { deadline.dispose(); }
  const parent = new AbortController();
  const disconnected = previewDeadline(parent.signal);
  try {
    const pending = disconnected.run(() => new Promise(() => {}));
    parent.abort(new Error("Disconnected"));
    await assert.rejects(pending, /Disconnected/);
    assert.equal(disconnected.signal.aborted, true);
  } finally { disconnected.dispose(); }
});

test("client bounds fetch and response-body hangs, keeps successes and retries only the failed file", async () => {
  const originalFetch = globalThis.fetch;
  const files = [new File(["a"], "same.pdf"), new File(["b"], "same.pdf"), new File(["c"], "last.pdf")];
  try {
    for (const hangBody of [false, true]) {
      let index = 0;
      let hungSignal: AbortSignal | undefined;
      globalThis.fetch = async (_url, options) => {
        const current = index++;
        if (current === 1) {
          hungSignal = options?.signal as AbortSignal;
          if (!hangBody) return new Promise(() => {});
          return { ok: true, json: () => new Promise(() => {}) } as Response;
        }
        return Response.json([{ dateiname: files[current].name, status: "success", error: null, bruttoBetrag: current + 1 }]);
      };
      const result = await extractPreviews(files, 10);
      assert.deepEqual(result.map(p => p.status), ["success", "error", "success"]);
      assert.match(result[1].error!, /Zeitüberschreitung/);
      assert.equal(hungSignal?.aborted, true);
      const first = result[0];
      const last = result[2];
      globalThis.fetch = async (_url, options) => {
        assert.deepEqual((options?.body as FormData).getAll("files"), [files[1]]);
        return Response.json([{ dateiname: files[1].name, status: "success", error: null }]);
      };
      [result[1]] = await extractPreviews([files[1]], 10);
      assert.equal(result[0], first);
      assert.equal(result[2], last);
      assert.ok(result.every(p => p.status === "success"));
    }
  } finally { globalThis.fetch = originalFetch; }
});
