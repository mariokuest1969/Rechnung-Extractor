import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, buchungskontenTable } from "@workspace/db";

const router: IRouter = Router();

function toApi(row: typeof buchungskontenTable.$inferSelect) {
  return {
    id: row.id,
    kontonummer: row.kontonummer,
    bezeichnung: row.bezeichnung,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/buchungskonten", async (_req, res): Promise<void> => {
  const rows = await db.select().from(buchungskontenTable).orderBy(buchungskontenTable.kontonummer);
  res.json(rows.map(toApi));
});

router.post("/buchungskonten", async (req, res): Promise<void> => {
  const { kontonummer, bezeichnung } = req.body as Record<string, unknown>;
  if (typeof kontonummer !== "string" || !kontonummer.trim()) {
    res.status(400).json({ error: "kontonummer ist erforderlich" }); return;
  }
  if (typeof bezeichnung !== "string" || !bezeichnung.trim()) {
    res.status(400).json({ error: "bezeichnung ist erforderlich" }); return;
  }
  const [row] = await db
    .insert(buchungskontenTable)
    .values({ kontonummer: kontonummer.trim(), bezeichnung: bezeichnung.trim() })
    .returning();
  res.status(201).json(toApi(row));
});

router.patch("/buchungskonten/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Ungültige ID" }); return; }
  const { kontonummer, bezeichnung } = req.body as Record<string, unknown>;
  const update: Record<string, unknown> = {};
  if (typeof kontonummer === "string" && kontonummer.trim()) update.kontonummer = kontonummer.trim();
  if (typeof bezeichnung === "string" && bezeichnung.trim()) update.bezeichnung = bezeichnung.trim();
  if (!Object.keys(update).length) { res.status(400).json({ error: "Keine Felder" }); return; }
  const [row] = await db.update(buchungskontenTable).set(update).where(eq(buchungskontenTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Nicht gefunden" }); return; }
  res.json(toApi(row));
});

router.delete("/buchungskonten/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Ungültige ID" }); return; }
  const [row] = await db.delete(buchungskontenTable).where(eq(buchungskontenTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Nicht gefunden" }); return; }
  res.sendStatus(204);
});

export default router;
