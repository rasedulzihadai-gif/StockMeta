import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaNextJsPostgresqlDb?: ReturnType<typeof drizzle>;
};

export function getDatabaseUrl(): string | null {
  const value = process.env.DATABASE_URL?.trim();
  return value ? value : null;
}

export function hasDatabaseUrl(): boolean {
  return !!getDatabaseUrl();
}

export function getPool(): Pool | null {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) return null;
  const pool = globalForDb.__arenaNextJsPostgresqlPool ?? new Pool({ connectionString: databaseUrl });
  globalForDb.__arenaNextJsPostgresqlPool = pool;
  return pool;
}

export function getDb() {
  const pool = getPool();
  if (!pool) return null;
  const db = globalForDb.__arenaNextJsPostgresqlDb ?? drizzle(pool);
  globalForDb.__arenaNextJsPostgresqlDb = db;
  return db;
}

export function requirePool(): Pool {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is required for PostgreSQL storage");
  return pool;
}

export function requireDb() {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required for PostgreSQL storage");
  return db;
}
