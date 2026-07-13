import { Pool } from "pg";

/**
 * Server-only Postgres pool. DATABASE_URL points at local Postgres in dev
 * and the Supabase connection pooler in production. This module must never
 * be imported from client components (I2) — it throws early if the URL is
 * missing rather than limping along.
 */
let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set (server-side only)");
    }
    pool = new Pool({ connectionString, max: 5 });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = null;
}
