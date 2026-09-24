import { getDb, hasDatabaseUrl } from "@/db";
import { sql } from "drizzle-orm";
import { getStorageInfo } from "@/lib/server/repo";

export const dynamic = "force-dynamic";

/** Liveness + storage diagnostics. `ephemeral: true` means the local JSON store had to
 *  fall back to a temp dir (read-only filesystem) — data won't survive a restart. */
export async function GET() {
  if (!hasDatabaseUrl()) {
    const info = await getStorageInfo();
    return Response.json({
      ok: true,
      storage: "local",
      storageDir: info.dir,
      ephemeral: info.ephemeral,
      warning: info.ephemeral
        ? "Storage is temporary (read-only filesystem) — uploads and API keys are lost on restart. Set DATABASE_URL for durable storage."
        : undefined,
    });
  }
  try {
    const db = getDb();
    if (!db) throw new Error("Database unavailable");
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, storage: "postgres", storageDir: null, ephemeral: false });
  } catch {
    return Response.json({ ok: false, storage: "postgres", storageDir: null, ephemeral: false }, { status: 500 });
  }
}
