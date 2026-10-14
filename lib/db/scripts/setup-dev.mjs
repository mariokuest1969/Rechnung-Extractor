import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

export function assertDevelopment(env) {
  if (env.NODE_ENV === "production" || env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("Schema-Setup abgebrochen: nur in der Entwicklungsumgebung erlaubt.");
  }
  if (!env.DATABASE_URL) {
    throw new Error("Schema-Setup abgebrochen: DATABASE_URL fehlt.");
  }
}

export async function setupDevelopment() {
  assertDevelopment(process.env);
  // No --force: never approve destructive changes automatically. Closed stdin
  // prevents a post-merge run from waiting for interactive rename decisions.
  const result = spawnSync("pnpm", ["exec", "drizzle-kit", "push", "--config", "./drizzle.config.ts"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 60_000,
  });
  // Drizzle can exit successfully on EOF at an interactive prompt. Only accept
  // its explicit completion messages; otherwise fail rather than silently skip.
  if (result.error || result.status !== 0 ||
      !/Changes applied|No changes detected/.test(result.stdout ?? "")) {
    throw new Error("Entwicklungs-Schema nicht angewendet. Verbindung und Schema prüfen; mögliche Konflikte mit `pnpm --filter @workspace/db run push` manuell prüfen. Es wurden keine destruktiven Änderungen automatisch bestätigt.");
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query("SELECT id, status, created_at, expires_at, result FROM reextract_jobs LIMIT 0");
  } catch {
    throw new Error("Entwicklungs-Schema nicht bereit: reextract_jobs fehlt, ist unvollständig oder die Datenbank ist nicht erreichbar.");
  } finally {
    await client.end();
  }
  console.log("Entwicklungs-Schema bereit (einschließlich reextract_jobs).");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  setupDevelopment().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
