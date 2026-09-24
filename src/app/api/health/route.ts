import { getDb, hasDatabaseUrl } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasDatabaseUrl()) return Response.json({ ok: true, storage: "local" });
  try {
    const db = getDb();
    if (!db) throw new Error("Database unavailable");
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, storage: "postgres" });
  } catch {
    return Response.json({ ok: false, storage: "postgres" }, { status: 500 });
  }
}
