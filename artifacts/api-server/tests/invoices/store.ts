import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
export { invoicesTable } from "../../../../lib/db/src/schema/invoices";
export { settingsTable } from "../../../../lib/db/src/schema/settings";

// All requests use one connection and a temporary table. Real invoices are never written.
export const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("CREATE TEMP TABLE invoices (LIKE public.invoices INCLUDING ALL)");
await client.query("CREATE TEMP TABLE settings (LIKE public.settings INCLUDING ALL)");
await client.query("CREATE TEMP SEQUENCE invoice_test_ids");
await client.query("ALTER TABLE pg_temp.invoices ALTER COLUMN id SET DEFAULT nextval('pg_temp.invoice_test_ids')");
await client.query("SET search_path TO pg_temp");
export const db = drizzle(client);
