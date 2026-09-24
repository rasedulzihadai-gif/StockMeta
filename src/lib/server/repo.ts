import { asc, eq, getTableColumns, inArray } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, assetImages, assets, providerSettings } from "@/db/schema";
import { ensureSchema } from "./bootstrap";
import { DEFAULT_PROVIDER_ID, getProviderDef } from "@/lib/providers/registry";
import {
  PLATFORM_IDS,
  isHint,
  isPlatformId,
  type AppSettingsDTO,
  type AssetDTO,
  type AssetStatus,
} from "@/lib/types";

export type AssetRow = typeof assets.$inferSelect;
export type AssetInsert = typeof assets.$inferInsert;
export type ProviderRow = typeof providerSettings.$inferSelect;
type AssetListRow = Omit<AssetRow, "rawResult">;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: AssetStatus[] = ["pending", "processing", "done", "error"];

export function toAssetDTO(r: AssetListRow): AssetDTO {
  return {
    id: r.id,
    filename: r.filename,
    width: r.width,
    height: r.height,
    hint: isHint(r.hint) ? r.hint : "auto",
    status: (STATUSES as string[]).includes(r.status) ? (r.status as AssetStatus) : "pending",
    error: r.error,
    providerId: r.providerId,
    model: r.model,
    result: r.result ?? null,
    issues: Array.isArray(r.issues) ? r.issues : [],
    fileType: r.fileType === "vector" || r.fileType === "raster" ? r.fileType : null,
    vectorCompanion: r.vectorCompanion,
    usage: r.usage ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// List queries never load the raw model JSON (kept only for audit / acceptance checks).
const { rawResult: _omitRaw, ...listColumns } = getTableColumns(assets);

export async function listAssets(): Promise<AssetDTO[]> {
  await ensureSchema();
  const rows = await db.select(listColumns).from(assets).orderBy(asc(assets.createdAt), asc(assets.id));
  return rows.map(toAssetDTO);
}

export async function getAssetsByIds(ids: string[]): Promise<AssetDTO[]> {
  await ensureSchema();
  const valid = ids.filter((id) => UUID_RE.test(id));
  if (!valid.length) return [];
  const rows = await db
    .select(listColumns)
    .from(assets)
    .where(inArray(assets.id, valid))
    .orderBy(asc(assets.createdAt), asc(assets.id));
  return rows.map(toAssetDTO);
}

export async function getAssetRow(id: string): Promise<AssetRow | null> {
  if (!UUID_RE.test(id)) return null;
  await ensureSchema();
  const rows = await db.select().from(assets).where(eq(assets.id, id));
  return rows[0] ?? null;
}

export async function createAsset(
  data: Pick<AssetInsert, "filename" | "width" | "height" | "hint" | "fileType" | "vectorCompanion">,
  images: { mime: string; thumb: Buffer; analysis: Buffer },
): Promise<AssetDTO> {
  await ensureSchema();
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(assets).values(data).returning();
    await tx.insert(assetImages).values({ assetId: row.id, ...images });
    return toAssetDTO(row);
  });
}

export async function updateAssetRow(id: string, patch: Partial<AssetInsert>): Promise<AssetDTO | null> {
  if (!UUID_RE.test(id)) return null;
  await ensureSchema();
  const rows = await db
    .update(assets)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(assets.id, id))
    .returning();
  return rows[0] ? toAssetDTO(rows[0]) : null;
}

export async function deleteAssets(ids: string[] | "all"): Promise<number> {
  await ensureSchema();
  if (ids === "all") {
    const rows = await db.delete(assets).returning({ id: assets.id });
    return rows.length;
  }
  const valid = ids.filter((id) => UUID_RE.test(id));
  if (!valid.length) return 0;
  const rows = await db.delete(assets).where(inArray(assets.id, valid)).returning({ id: assets.id });
  return rows.length;
}

export async function getAssetImage(id: string, kind: "thumb" | "analysis"): Promise<{ data: Buffer; mime: string } | null> {
  if (!UUID_RE.test(id)) return null;
  await ensureSchema();
  const rows = await db
    .select({ data: kind === "thumb" ? assetImages.thumb : assetImages.analysis, mime: assetImages.mime })
    .from(assetImages)
    .where(eq(assetImages.assetId, id));
  return rows[0] ?? null;
}

/* ---------------- settings ---------------- */
function normalizeSettings(row: typeof appSettings.$inferSelect | undefined): AppSettingsDTO {
  const active = row && getProviderDef(row.activeProviderId) ? row.activeProviderId : DEFAULT_PROVIDER_ID;
  const platforms = Array.isArray(row?.platforms) ? row.platforms.filter(isPlatformId) : [];
  return {
    activeProviderId: active,
    platforms: platforms.length ? platforms : [...PLATFORM_IDS],
    defaultHint: isHint(row?.defaultHint) ? row.defaultHint : "auto",
    concurrency: Math.min(8, Math.max(1, row?.concurrency ?? 3)),
  };
}

export async function getSettings(): Promise<AppSettingsDTO> {
  await ensureSchema();
  let rows = await db.select().from(appSettings).where(eq(appSettings.id, 1));
  if (!rows[0]) {
    await db.insert(appSettings).values({ id: 1 }).onConflictDoNothing();
    rows = await db.select().from(appSettings).where(eq(appSettings.id, 1));
  }
  return normalizeSettings(rows[0]);
}

export async function updateSettings(patch: Partial<AppSettingsDTO>): Promise<AppSettingsDTO> {
  await getSettings();
  const set: Partial<typeof appSettings.$inferInsert> = { updatedAt: new Date() };
  if (patch.activeProviderId !== undefined) set.activeProviderId = patch.activeProviderId;
  if (patch.platforms !== undefined) set.platforms = patch.platforms;
  if (patch.defaultHint !== undefined) set.defaultHint = patch.defaultHint;
  if (patch.concurrency !== undefined) set.concurrency = patch.concurrency;
  const rows = await db.update(appSettings).set(set).where(eq(appSettings.id, 1)).returning();
  return normalizeSettings(rows[0]);
}

/* ---------------- provider slots ---------------- */
export async function getProviderRows(): Promise<ProviderRow[]> {
  await ensureSchema();
  return db.select().from(providerSettings);
}

export async function getProviderRow(id: string): Promise<ProviderRow | null> {
  await ensureSchema();
  const rows = await db.select().from(providerSettings).where(eq(providerSettings.id, id));
  return rows[0] ?? null;
}

export async function upsertProviderRow(
  id: string,
  patch: Partial<Omit<typeof providerSettings.$inferInsert, "id">>,
): Promise<ProviderRow> {
  await ensureSchema();
  const rows = await db
    .insert(providerSettings)
    .values({ id, ...patch, updatedAt: new Date() })
    .onConflictDoUpdate({ target: providerSettings.id, set: { ...patch, updatedAt: new Date() } })
    .returning();
  return rows[0];
}
