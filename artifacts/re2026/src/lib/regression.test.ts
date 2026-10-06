import assert from "node:assert/strict";
import test from "node:test";
import type { Invoice } from "@workspace/api-client-react";
import { runPersistentReextractJob } from "./reextract-job";
import {
  MAX_BULK_REEXTRACT_INVOICES,
  createBulkReextractBlock,
  processSequentially,
} from "./bulk-reextract";
import {
  createPositionExportObjects,
  createPositionExportRows,
} from "./position-export";

test("polling survives restart outage, reports interruption, and processes the next invoice", async () => {
  const replies: Array<Response | Error> = [
    Response.json({ jobId: "old" }), new Error("connection reset"),
    new Response("restarting", { status: 502 }),
    Response.json({ status: "processing" }),
    Response.json({ status: "error", error: "Bitte erneut auslesen.", retryable: true }, { status: 409 }),
    Response.json({ jobId: "new" }),
    Response.json({ status: "success", invoice: { id: 2 }, extractedPositionCount: 1 }),
  ];
  let posts = 0;
  const request: typeof fetch = async (_url, init) => {
    if (init?.method === "POST") posts++;
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    assert.ok(reply);
    return reply;
  };
  const outcomes = await processSequentially([1, 2], (id) =>
    runPersistentReextractJob(id, request, async () => {}));
  assert.equal(outcomes[0].status, "rejected");
  assert.equal(outcomes[1].status, "fulfilled");
  assert.equal(posts, 2);
  assert.equal(replies.length, 0);
});

test("processing continues after a timeout or individual error", async () => {
  const visited: number[] = [];
  const results = await processSequentially([1, 2, 3], async (id) => {
    visited.push(id);
    if (id < 3) throw new Error(id === 1 ? "timeout" : "AI error");
    return "success";
  });
  assert.deepEqual(visited, [1, 2, 3]);
  assert.deepEqual(results.map((result) => result.status), [
    "rejected",
    "rejected",
    "fulfilled",
  ]);
});

test("more than 20 selected invoices leave an unambiguous next block", () => {
  const invoices = Array.from({ length: 25 }, (_, index) => ({ id: index + 1 }));
  const { queue, remainingIds } = createBulkReextractBlock(invoices);
  assert.equal(queue.length, MAX_BULK_REEXTRACT_INVOICES);
  assert.deepEqual(queue.map(({ id }) => id), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.deepEqual([...remainingIds], [21, 22, 23, 24, 25]);
});

test("updated positions are present in CSV and Excel export data", () => {
  const invoice = {
    id: 1,
    createdAt: "2026-09-05T00:00:00.000Z",
    dateiname: "rechnung.pdf",
    rechnungssteller: "Muster GmbH",
    rechnungsnummer: "R-1",
    datum: "2026-09-05",
    waehrung: "EUR",
    positionen: [
      {
        positionsnummer: "10",
        beschreibung: "Erfolgreich aktualisiert",
        menge: 2,
        einzelpreis: 12.5,
        nettobetrag: 25,
      },
    ],
  } as Invoice;

  const csvRows = createPositionExportRows([invoice]);
  const excelRows = createPositionExportObjects([invoice]);
  assert.equal(csvRows.length, 1);
  assert.ok(csvRows[0]?.includes("Erfolgreich aktualisiert"));
  assert.deepEqual(excelRows, [
    {
      Dateiname: "rechnung.pdf",
      Rechnungssteller: "Muster GmbH",
      Datum: "2026-09-05",
      Rechnungsnummer: "R-1",
      Positionsnummer: "10",
      Beschreibung: "Erfolgreich aktualisiert",
      Menge: 2,
      Einheit: "",
      Einzelpreis: 12.5,
      "MwSt %": "",
      Netto: 25,
      Brutto: "",
      Währung: "EUR",
    },
  ]);
});