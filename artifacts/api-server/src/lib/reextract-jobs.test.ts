import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { db, pool, reextractJobsTable as jobs } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { createReextractJob, readReextractJob, commitReextractJob, failReextractJob, maintainReextractJobs } from "./reextract-jobs";
import { assertReextractSchema } from "./reextract-schema";

test("missing job schema gives actionable setup instructions, including wrapped database errors", async () => {
  for (const code of ["42P01", "42703"]) {
    await assert.rejects(
      assertReextractSchema(async () => { throw { cause: { code } }; }),
      /reextract_jobs.*setup:dev.*Produktion/,
    );
  }
  const connectionError = new Error("connection unavailable");
  await assert.rejects(
    assertReextractSchema(async () => { throw connectionError; }),
    (error) => error === connectionError,
  );
});

test("configured job schema passes the read-only startup check", async () => {
  await assertReextractSchema();
});

const ids: string[] = [];
async function create() {
  const id = randomUUID();
  ids.push(id);
  await createReextractJob(id);
  return id;
}
after(async () => {
  if (ids.length) await db.delete(jobs).where(inArray(jobs.id, ids));
  await pool.end();
});

test("durable completed jobs can be read by a fresh process without worker memory", async () => {
  const id = await create();
  await commitReextractJob(id, async () => ({ invoice: { id: 123 }, extractedPositionCount: 2 }));
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", `
    import pg from 'pg';
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const result = await client.query("SELECT status, result FROM reextract_jobs WHERE id=$1", [process.argv[1]]);
    console.log(JSON.stringify(result.rows[0]));
    await client.end();
  `, id], { cwd: resolve(process.cwd(), "../../lib/db") });
  const saved = JSON.parse(stdout);
  assert.equal(saved.status, "success");
  assert.equal(saved.result.extractedPositionCount, 2);
  await failReextractJob(id, { error: "late failure" });
  assert.equal((await readReextractJob(id))?.status, "success");
});

test("orphaned processing jobs expire as retryable; live leases are not interrupted", async () => {
  const orphan = await create();
  const live = await create();
  await db.update(jobs).set({ expiresAt: new Date(0) }).where(eq(jobs.id, orphan));
  await maintainReextractJobs();
  assert.equal((await readReextractJob(orphan))?.retryable, true);
  assert.equal((await readReextractJob(live))?.status, "processing");
  let wrote = false;
  await assert.rejects(commitReextractJob(orphan, async () => { wrote = true; return {}; }));
  assert.equal(wrote, false);
});

test("rollback cannot publish success; terminal jobs are automatically pruned", async () => {
  const id = await create();
  await assert.rejects(commitReextractJob(id, async (tx) => {
    await tx.update(jobs).set({ result: { partial: true } }).where(eq(jobs.id, id));
    throw new Error("transaction failed");
  }));
  assert.equal((await readReextractJob(id))?.partial, undefined);
  await failReextractJob(id, { error: "failed", httpStatus: 500 });
  await db.update(jobs).set({ expiresAt: new Date(0) }).where(eq(jobs.id, id));
  await maintainReextractJobs();
  assert.equal(await readReextractJob(id), undefined);
});

