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

export default router;
