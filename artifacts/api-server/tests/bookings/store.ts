import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "node:crypto";
export { invoicesTable } from "../../../../lib/db/src/schema/invoices";
export { bookingTemplatesTable, bookingOccurrencesTable } from "../../../../lib/db/src/schema/booking-templates";

if (process.env.REPLIT_DEPLOYMENT === "1" || process.env.NODE_ENV === "production")
  throw new Error("Booking integration tests are development-only.");
const schema = `booking_test_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();
await admin.query(`CREATE SCHEMA "${schema}"`);
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${schema}`,
  max: 8,
});
export const db = drizzle(pool);
for (const table of ["invoices", "booking_templates", "booking_occurrences"]) {
  await pool.query(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
  await pool.query(`CREATE SEQUENCE ${table}_test_ids`);
  await pool.query(`ALTER TABLE ${table} ALTER COLUMN id SET DEFAULT nextval('${table}_test_ids')`);
}
await pool.query(`ALTER TABLE booking_occurrences
  ADD FOREIGN KEY (template_id) REFERENCES booking_templates(id),
  ADD FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL`);
export async function cleanup() {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
