import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, bookingTemplatesTable as templates, bookingOccurrencesTable as occurrences, invoicesTable } from "@workspace/db";
import {
  CreateBookingTemplateBody, ConfirmDueBookingBody, ListBookingTemplatesResponse,
  ListDueBookingsResponse, ConfirmDueBookingResponse, CreateManualBookingResponse,
  CreateBookingTemplateResponse,
} from "@workspace/api-zod";
import { bookingValues, validateBooking, BookingInputError } from "../lib/manual-booking";
import { berlinToday, dueDates, validCalendarDate } from "../lib/booking-calendar";
import { parseInvoiceId } from "../lib/invoice-ids";
import { toApiInvoice } from "../lib/invoice-api";

const router: IRouter = Router();
class BookingConflict extends Error {}
class BookingNotFound extends Error {}

function templateInput(raw: unknown) {
  const parsed = CreateBookingTemplateBody.safeParse(raw);
  if (!parsed.success) throw new BookingInputError("Bitte eine gültige Vorlage mit Starttermin und Intervall eingeben.");
  if (!validCalendarDate(parsed.data.startDate)) throw new BookingInputError("Ungültiger Starttermin.");
  const booking = validateBooking(parsed.data.booking);
  const values = bookingValues(booking);
  return { ...parsed.data, booking: {
    ...booking,
    bruttoBetrag: Number(values.bruttoBetrag),
    nettoBetrag: Number(values.nettoBetrag),
    steuerBetrag: Number(values.steuerBetrag),
    steuersatz: values.steuersatz == null ? null : Number(values.steuersatz),
  } };
}
async function templateApi(row: typeof templates.$inferSelect) {
  const confirmed = await db.select({ id: occurrences.id }).from(occurrences).where(eq(occurrences.templateId, row.id)).limit(1);
  return { id: row.id, booking: row.booking, startDate: row.startDate, intervalMonths: row.intervalMonths,
    status: row.status, scheduleLocked: confirmed.length > 0 };
}

router.post("/bookings/manual", async (req, res): Promise<void> => {
  const [row] = await db.insert(invoicesTable).values(bookingValues(req.body)).returning();
  res.status(201).json(CreateManualBookingResponse.parse(toApiInvoice(row)));
});
router.get("/bookings/templates", async (_req, res): Promise<void> => {
  const rows = await db.select().from(templates).orderBy(templates.id);
  res.json(ListBookingTemplatesResponse.parse(await Promise.all(rows.map(templateApi))));
});
router.post("/bookings/templates", async (req, res): Promise<void> => {
  const input = templateInput(req.body);
  if (input.status === "ended") throw new BookingInputError("Neue Vorlagen können nicht beendet angelegt werden.");
  const [row] = await db.insert(templates).values(input).returning();
  res.status(201).json(CreateBookingTemplateResponse.parse(await templateApi(row)));
});
router.patch("/bookings/templates/:id", async (req, res): Promise<void> => {
  const id = parseInvoiceId(req.params.id);
  if (!id) throw new BookingInputError("Ungültige Vorlagen-ID.");
  const input = templateInput(req.body);
  const row = await db.transaction(async tx => {
    const [current] = await tx.select().from(templates).where(eq(templates.id, id)).for("update");
    if (!current) throw new BookingNotFound("Vorlage nicht gefunden.");
    if (current.status === "ended") throw new BookingConflict("Beendete Vorlagen können nicht geändert werden.");
    const confirmed = await tx.select({ id: occurrences.id }).from(occurrences).where(eq(occurrences.templateId, id)).limit(1);
    if (confirmed.length && (input.startDate !== current.startDate || input.intervalMonths !== current.intervalMonths))
      throw new BookingConflict("Nach der ersten Bestätigung sind Starttermin und Intervall gesperrt. Bitte eine neue Vorlage anlegen.");
    const [updated] = await tx.update(templates).set(input).where(eq(templates.id, id)).returning();
    return updated;
  });
  res.json(CreateBookingTemplateResponse.parse(await templateApi(row)));
});
router.get("/bookings/due", async (_req, res): Promise<void> => {
  // Read-only: opening this list never creates a booking or an occurrence.
  const rows = await db.select().from(templates).where(eq(templates.status, "active"));
  const confirmed = await db.select({ templateId: occurrences.templateId, dueDate: occurrences.dueDate }).from(occurrences);
  const keys = new Set(confirmed.map(c => `${c.templateId}:${c.dueDate}`));
  const today = berlinToday();
  const due = rows.flatMap(row => dueDates(row.startDate, row.intervalMonths, today)
    .filter(date => !keys.has(`${row.id}:${date}`))
    .map(dueDate => ({ templateId: row.id, dueDate, booking: { ...row.booking, datum: dueDate } })));
  due.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.templateId - b.templateId);
  res.json(ListDueBookingsResponse.parse(due));
});
router.post("/bookings/templates/:id/confirm", async (req, res): Promise<void> => {
  const id = parseInvoiceId(req.params.id);
  const input = ConfirmDueBookingBody.safeParse(req.body);
  if (!id || !input.success || !validCalendarDate(input.data.dueDate)) throw new BookingInputError("Ungültige Vorlage oder Fälligkeit.");
  const { dueDate } = input.data;
  const result = await db.transaction(async tx => {
    // Same lock is used by pause/end/edit, and all concurrent confirmations.
    const [row] = await tx.select().from(templates).where(eq(templates.id, id)).for("update");
    if (!row) throw new BookingNotFound("Vorlage nicht gefunden.");
    const [existing] = await tx.select().from(occurrences).where(and(eq(occurrences.templateId, id), eq(occurrences.dueDate, dueDate)));
    if (existing) return { invoiceId: existing.invoiceId, alreadyConfirmed: true };
    if (row.status !== "active" || !dueDates(row.startDate, row.intervalMonths, berlinToday()).includes(dueDate))
      throw new BookingConflict("Termin ist nicht fällig oder die Vorlage ist pausiert/beendet. Bitte Liste aktualisieren.");
    const [invoice] = await tx.insert(invoicesTable).values({
      ...bookingValues({ ...row.booking, datum: dueDate }),
      herkunft: "recurring", wiederholungVorlageId: id, faelligkeitsdatum: dueDate,
      // Confirmation approves creation, not completion of human bookkeeping review.
      bearbeitungsstatus: "unreviewed",
    }).returning();
    await tx.insert(occurrences).values({ templateId: id, dueDate, invoiceId: invoice.id });
    return { invoiceId: invoice.id, alreadyConfirmed: false };
  });
  res.json(ConfirmDueBookingResponse.parse(result));
});
router.use((error: unknown, _req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  if (error instanceof BookingInputError || error instanceof BookingConflict || error instanceof BookingNotFound) {
    res.status(error instanceof BookingInputError ? 400 : error instanceof BookingConflict ? 409 : 404).json({ error: error.message });
    return;
  }
  next(error);
});
export default router;
