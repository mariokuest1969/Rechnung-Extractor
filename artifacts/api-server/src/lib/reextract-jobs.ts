import { and, eq, lte, ne, sql } from "drizzle-orm";
import { db, reextractJobsTable as jobs } from "@workspace/db";

// Longer than extraction (70s) plus the bounded persistence transaction.
const LEASE_MS = 120_000;
const RETENTION_MS = 30 * 60_000;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function createReextractJob(id: string): Promise<void> {
  await db.insert(jobs).values({
    id, status: "processing", expiresAt: new Date(Date.now() + LEASE_MS),
  });
}

export async function maintainReextractJobs(): Promise<void> {
  const now = new Date();
  // UPDATE takes a row lock, so it cannot overtake an in-flight invoice commit.
  await db.update(jobs).set({
    status: "error",
    expiresAt: new Date(now.getTime() + RETENTION_MS),
    result: {
      error: "Neu-Extraktion unterbrochen (z. B. durch einen Serverneustart). Bitte erneut auslesen.",
      httpStatus: 409,
      retryable: true,
    },
  }).where(and(eq(jobs.status, "processing"), lte(jobs.expiresAt, now)));
  await db.delete(jobs).where(and(ne(jobs.status, "processing"), lte(jobs.expiresAt, now)));
}

export async function readReextractJob(id: string): Promise<(Record<string, unknown> & { status: string; createdAt: number }) | undefined> {
  await maintainReextractJobs();
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  if (!row) return undefined;
  return { ...row.result, status: row.status, createdAt: row.createdAt.getTime() };
}

export async function finishReextractJob(
  tx: Transaction,
  id: string,
  status: "success" | "error",
  result: Record<string, unknown>,
): Promise<void> {
  await tx.update(jobs).set({
    status, result, expiresAt: new Date(Date.now() + RETENTION_MS),
  }).where(and(eq(jobs.id, id), eq(jobs.status, "processing")));
}

// Fence an expired worker BEFORE it changes invoice data. Persist the result
// in this same transaction so a crash after COMMIT cannot lose the success.
export async function commitReextractJob(
  id: string,
  persist: (tx: Transaction) => Promise<Record<string, unknown>>,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw("SET LOCAL statement_timeout = '5000ms'"));
    await tx.execute(sql.raw("SET LOCAL lock_timeout = '2000ms'"));
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, id)).for("update");
    if (!job || job.status !== "processing" || job.expiresAt.getTime() <= Date.now()) {
      throw new Error("Neu-Extraktionsauftrag abgelaufen. Bitte erneut auslesen.");
    }
    const result = await persist(tx);
    await finishReextractJob(tx, id, "success", result);
  });
}

export async function failReextractJob(id: string, result: Record<string, unknown>): Promise<void> {
  await db.transaction((tx) => finishReextractJob(tx, id, "error", result));
}
