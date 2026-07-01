import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, lieferantenTable } from "@workspace/db";

const router: IRouter = Router();

function toApi(row: typeof lieferantenTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    kuerzel: row.kuerzel ?? null,
    steuernummer: row.steuernummer ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/lieferanten", async (_req, res): Promise<void> => {
  const rows = await db.select().from(lieferantenTable).orderBy(lieferantenTable.name);
  res.json(rows.map(toApi));
});

router.post("/lieferanten", async (req, res): Promise<void> => {
  const { name, kuerzel, steuernummer } = req.body as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name ist erforderlich" });
    return;
  }
  const [row] = await db
    .insert(lieferantenTable)
    .values({ name: name.trim(), kuerzel: (kuerzel as string) ?? null, steuernummer: (steuernummer as string) ?? null })
    .returning();
  res.status(201).json(toApi(row));
});

router.patch("/lieferanten/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Ungültige ID" }); return; }
  const { name, kuerzel, steuernummer } = req.body as Record<string, unknown>;
  const update: Record<string, unknown> = {};
  if (typeof name === "string" && name.trim()) update.name = name.trim();
  if (kuerzel !== undefined) update.kuerzel = kuerzel ?? null;
  if (steuernummer !== undefined) update.steuernummer = steuernummer ?? null;
  if (!Object.keys(update).length) { res.status(400).json({ error: "Keine Felder" }); return; }
  const [row] = await db.update(lieferantenTable).set(update).where(eq(lieferantenTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Nicht gefunden" }); return; }
  res.json(toApi(row));
});

router.delete("/lieferanten/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Ungültige ID" }); return; }
  const [row] = await db.delete(lieferantenTable).where(eq(lieferantenTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Nicht gefunden" }); return; }
  res.sendStatus(204);
});

// ─── CSV helpers ──────────────────────────────────────────────────────────────
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ';' && !inQ) {
      result.push(cur.trim()); cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

function csvEsc(s: string | null): string {
  const v = s ?? "";
  return v.includes(";") || v.includes('"') || v.includes("\n")
    ? `"${v.replace(/"/g, '""')}"` : v;
}

// ─── Export: GET /api/lieferanten/export ─────────────────────────────────────
router.get("/lieferanten/export", async (_req, res): Promise<void> => {
  const rows = await db.select().from(lieferantenTable).orderBy(lieferantenTable.name);
  const lines = ["Name;Kuerzel;Steuernummer"];
  for (const r of rows) {
    lines.push([csvEsc(r.name), csvEsc(r.kuerzel), csvEsc(r.steuernummer)].join(";"));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="lieferanten.csv"');
  res.send("\uFEFF" + lines.join("\r\n"));
});

// ─── Import: POST /api/lieferanten/import ────────────────────────────────────
router.post("/lieferanten/import", async (req, res): Promise<void> => {
  const { csv } = req.body as { csv?: string };
  if (!csv || typeof csv !== "string") { res.status(400).json({ error: "csv erforderlich" }); return; }

  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) { res.status(400).json({ error: "Keine Daten gefunden" }); return; }

  const headers = parseCsvLine(lines[0]);
  const isLexware = headers.includes("Firmenname");

  const nameIdx    = isLexware ? headers.indexOf("Firmenname")         : 0;
  const kuerzelIdx = isLexware ? headers.indexOf("Lieferantennummer")  : 1;
  const stNrIdx    = isLexware ? headers.indexOf("Steuernummer")       : 2;
  const ustIdIdx   = isLexware ? headers.indexOf("Umsatzsteuer ID")    : -1;

  const existing = await db.select({ name: lieferantenTable.name }).from(lieferantenTable);
  const existingNames = new Set(existing.map((r) => r.name.toLowerCase()));

  let imported = 0, skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const name = cols[nameIdx] ?? "";
    if (!name) { skipped++; continue; }
    if (existingNames.has(name.toLowerCase())) { skipped++; continue; }

    const kuerzel     = cols[kuerzelIdx] || null;
    const steuernummer = cols[stNrIdx] || (ustIdIdx >= 0 ? cols[ustIdIdx] : null) || null;

    await db.insert(lieferantenTable).values({ name, kuerzel, steuernummer });
    existingNames.add(name.toLowerCase());
    imported++;
  }

  res.json({ imported, skipped });
});

export default router;
