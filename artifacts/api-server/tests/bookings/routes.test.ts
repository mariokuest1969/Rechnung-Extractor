import assert from "node:assert/strict";
import { test, after } from "node:test";
import { once } from "node:events";
import express from "express";
import router from "../../src/routes/bookings";
import { pool, cleanup } from "./store";
import { berlinToday, dueDates, occurrenceDate, validCalendarDate } from "../../src/lib/booking-calendar";
import { bookingValues } from "../../src/lib/manual-booking";

const app = express();
app.use(express.json());
app.use(router);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: err.message });
});
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/bookings`;
after(async () => { server.close(); await cleanup(); });
async function request(path: string, data?: unknown, method = "POST") {
  const response = await fetch(`${base}${path}`, {
    method: data === undefined ? "GET" : method,
    headers: { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: response.status, body: await response.json() };
}
const booking = {
  datum: "2026-01-31", buchungstext: "Isolierte Testbuchung", waehrung: "EUR",
  bruttoBetrag: 119, steuersatz: 19, buchungskonto1: "4200", buchungskonto1Betrag: 119,
};
async function template(overrides = {}) {
  const input = { booking, startDate: "2026-01-31", intervalMonths: 1, status: "active", ...overrides };
  const result = await request("/templates", input);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return { input, id: result.body.id };
}
test("calendar keeps anchors, leap years and all overdue dates, Berlin DST boundaries", () => {
  assert.deepEqual(dueDates("2024-01-31", 1, "2024-04-30"), ["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30"]);
  assert.equal(occurrenceDate("2024-02-29", 12, 1), "2025-02-28");
  assert.equal(occurrenceDate("2024-02-29", 12, 4), "2028-02-29");
  assert.deepEqual(dueDates("2025-11-30", 3, "2026-08-31"), ["2025-11-30", "2026-02-28", "2026-05-30", "2026-08-30"]);
  assert.deepEqual(dueDates("2028-01-31", 1, "2027-12-31"), []);
  assert.equal(berlinToday(new Date("2026-03-29T22:30:00Z")), "2026-03-30");
  assert.equal(berlinToday(new Date("2026-10-25T23:30:00Z")), "2026-10-26");
  assert.equal(validCalendarDate("2026-02-29"), false);
  assert.equal(validCalendarDate("2024-02-29"), true);
});
test("manual money validation calculates single/split server side including credits and limits", () => {
  assert.equal(bookingValues(booking).nettoBetrag, "100.00");
  assert.equal(bookingValues({ ...booking, bruttoBetrag: -119 }).steuerBetrag, "-19.00");
  assert.equal(bookingValues({ ...booking, bruttoBetrag: 0 }).bruttoBetrag, "0.00");
  for (const raw of [
    { ...booking, bruttoBetrag: 1.001 },
    { ...booking, buchungskonto1Betrag: 1e-8 },
    { ...booking, bruttoBetrag: 10000000000 },
    { ...booking, datum: "2026-02-30" },
    { ...booking, buchungstext: "   " },
    { ...booking, bruttoBetrag: null },
  ]) assert.throws(() => bookingValues(raw));
  const split = { ...booking, steuerModus: "split", bruttoBetrag: undefined, steuersatz: undefined, netto7: 100, netto19: 100, netto0: 10 };
  assert.equal(bookingValues(split).bruttoBetrag, "236");
  assert.equal(bookingValues({ ...split, netto7: -0.5, netto19: null, netto0: null }).steuer7, "-0.04");
  assert.throws(() => bookingValues({ ...split, netto7: 9999999999.99 }));
});
test("manual save creates a tagged editable/exportable invoice, never a file link", async () => {
  const result = await request("/manual", { ...booking, dateiname: "fake.pdf", dropboxFileId: "fake", herkunft: "pdf", bearbeitungsstatus: "to_review" });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.herkunft, "manual");
  assert.equal(result.body.bearbeitungsstatus, "to_review");
  assert.equal(result.body.dateiname, null);
  assert.equal(result.body.dropboxFileId, null);
  assert.equal(result.body.nettoBetrag, 100);
  assert.equal((await request("/manual", { ...booking, bruttoBetrag: 1.001 })).status, 400);
});
test("split templates expose calculated amounts and preserve them on status-only changes", async () => {
  const split = { datum: "2026-01-31", buchungstext: "Nettoaufteilung", waehrung: "EUR",
    steuerModus: "split", netto7: 100, netto19: 100, netto0: 10 };
  const result = await request("/templates", { booking: split, startDate: split.datum, intervalMonths: 1, status: "active" });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.booking.bruttoBetrag, 236);
  const due = (await request("/due")).body.find((d: any) => d.templateId === result.body.id);
  assert.equal(due.booking.bruttoBetrag, 236);
  const paused = await request(`/templates/${result.body.id}`, { ...result.body, status: "paused" }, "PATCH");
  assert.equal(paused.status, 200, JSON.stringify(paused.body));
  assert.equal(paused.body.booking.bruttoBetrag, 236);
});
test("template/due reads create no bookings; simultaneous confirmation inserts exactly once", async () => {
  const before = Number((await pool.query("SELECT count(*) FROM invoices")).rows[0].count);
  const t = await template();
  const list = await request("/due");
  const today = berlinToday();
  assert.deepEqual(list.body.filter((d: any) => d.templateId === t.id).map((d: any) => d.dueDate), dueDates(t.input.startDate, 1, today));
  await request("/due");
  assert.equal(Number((await pool.query("SELECT count(*) FROM invoices")).rows[0].count), before);
  const confirms = await Promise.all(Array.from({ length: 8 }, () => request(`/templates/${t.id}/confirm`, { dueDate: "2026-01-31" })));
  assert.ok(confirms.every(c => c.status === 200), JSON.stringify(confirms));
  assert.equal(new Set(confirms.map(c => c.body.invoiceId)).size, 1);
  assert.equal(confirms.filter(c => !c.body.alreadyConfirmed).length, 1);
  assert.equal(Number((await pool.query("SELECT count(*) FROM invoices")).rows[0].count), before + 1);
  const invoice = (await pool.query("SELECT * FROM invoices WHERE id = $1", [confirms[0].body.invoiceId])).rows[0];
  assert.equal(invoice.herkunft, "recurring");
  assert.equal(invoice.bearbeitungsstatus, "unreviewed");
  assert.equal((await request(`/templates/${t.id}`, { ...t.input, startDate: "2026-02-01" }, "PATCH")).status, 409);
  await pool.query("DELETE FROM invoices WHERE id = $1", [invoice.id]);
  const retry = await request(`/templates/${t.id}/confirm`, { dueDate: "2026-01-31" });
  assert.deepEqual(retry.body, { invoiceId: null, alreadyConfirmed: true });
  assert.ok(!(await request("/due")).body.some((d: any) => d.templateId === t.id && d.dueDate === "2026-01-31"));
});
test("pause/resume preserves backlog, ending is final, edits affect only new confirmations", async () => {
  const t = await template({ startDate: "2026-01-01", intervalMonths: 3 });
  assert.equal((await request(`/templates/${t.id}`, { ...t.input, status: "paused" }, "PATCH")).status, 200);
  assert.ok(!(await request("/due")).body.some((d: any) => d.templateId === t.id));
  assert.equal((await request(`/templates/${t.id}/confirm`, { dueDate: "2026-01-01" })).status, 409);
  assert.equal((await request(`/templates/${t.id}`, { ...t.input, booking: { ...booking, bruttoBetrag: 238, bearbeitungsstatus: "done" } }, "PATCH")).status, 200);
  assert.ok((await request("/due")).body.some((d: any) => d.templateId === t.id && d.dueDate === "2026-01-01"));
  const confirmed = await request(`/templates/${t.id}/confirm`, { dueDate: "2026-01-01" });
  const invoice = (await pool.query("SELECT * FROM invoices WHERE id = $1", [confirmed.body.invoiceId])).rows[0];
  assert.equal(invoice.brutto_betrag, "238.00");
  assert.equal(invoice.bearbeitungsstatus, "unreviewed");
  await request(`/templates/${t.id}`, { ...t.input, status: "ended" }, "PATCH");
  assert.equal((await request(`/templates/${t.id}`, t.input, "PATCH")).status, 409);
  assert.equal((await request(`/templates/${t.id}/confirm`, { dueDate: "2026-04-01" })).status, 409);
  assert.equal((await pool.query("SELECT brutto_betrag FROM invoices WHERE id = $1", [invoice.id])).rows[0].brutto_betrag, "238.00");
});
test("invalid/future dates rejected; failed occurrence insert rolls back the invoice too", async () => {
  const t = await template({ startDate: "2026-01-02" });
  assert.equal((await request(`/templates/${t.id}/confirm`, { dueDate: "2099-01-02" })).status, 409);
  assert.equal((await request(`/templates/${t.id}/confirm`, { dueDate: "2026-01-03" })).status, 409);
  assert.equal((await request(`/templates/${t.id}/confirm`, { dueDate: "2026-02-30" })).status, 400);
  await pool.query(`ALTER TABLE booking_occurrences ADD CONSTRAINT injected_failure CHECK (template_id <> ${t.id})`);
  const before = Number((await pool.query("SELECT count(*) FROM invoices")).rows[0].count);
  assert.equal((await request(`/templates/${t.id}/confirm`, { dueDate: "2026-01-02" })).status, 500);
  assert.equal(Number((await pool.query("SELECT count(*) FROM invoices")).rows[0].count), before);
  assert.equal(Number((await pool.query("SELECT count(*) FROM booking_occurrences WHERE template_id = $1", [t.id])).rows[0].count), 0);
  await pool.query("ALTER TABLE booking_occurrences DROP CONSTRAINT injected_failure");
  assert.equal((await request(`/templates/${t.id}/confirm`, { dueDate: "2026-01-02" })).status, 200);
});
