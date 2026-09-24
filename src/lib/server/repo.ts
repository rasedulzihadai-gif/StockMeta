import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { asc, eq, getTableColumns, inArray } from "drizzle-orm";
import { getDb, hasDatabaseUrl } from "@/db";
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
type SettingsRow = typeof appSettings.$inferSelect;
type AssetListRow = Omit<AssetRow, "rawResult">;
type LocalAssetRow = Omit<AssetRow, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };
type LocalProviderRow = Omit<ProviderRow, "updatedAt"> & { updatedAt: string };
type LocalSettingsRow = Omit<SettingsRow, "updatedAt"> & { updatedAt: string };

interface LocalStore {
  settings?: LocalSettingsRow;
  providers: Record<string, LocalProviderRow>;
  assets: LocalAssetRow[];
  images: Record<string, { mime: string }>;
}

const LOCAL_STORE_DIR = path.join(process.cwd(), ".data", "stockmeta");
const LOCAL_STORE_FILE = path.join(LOCAL_STORE_DIR, "store.json");
const LOCAL_IMAGES_DIR = path.join(LOCAL_STORE_DIR, "images");
const LOCAL_THUMB_NAME = "thumb.jpg";
const LOCAL_ANALYSIS_NAME = "analysis.bin";
const LOCAL_QUEUE_KEY = "__stockmetaLocalStoreQueue" as const;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: AssetStatus[] = ["pending", "processing", "done", "error"];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const byCreated = <T extends { createdAt: Date; id: string }>(a: T, b: T) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
const nowIso = () => new Date().toISOString();
const localImageDir = (id: string) => path.join(LOCAL_IMAGES_DIR, id);
const localThumbPath = (id: string) => path.join(localImageDir(id), LOCAL_THUMB_NAME);
const localAnalysisPath = (id: string) => path.join(localImageDir(id), LOCAL_ANALYSIS_NAME);

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

function storageMode(): "postgres" | "local" {
  return hasDatabaseUrl() ? "postgres" : "local";
}

function defaultLocalStore(): LocalStore {
  return { providers: {}, assets: [], images: {} };
}

function normalizeLocalStore(data: unknown): LocalStore {
  if (!isObj(data)) return defaultLocalStore();
  return {
    settings: isObj(data.settings) ? (data.settings as LocalSettingsRow) : undefined,
    providers: isObj(data.providers) ? (data.providers as Record<string, LocalProviderRow>) : {},
    assets: Array.isArray(data.assets) ? (data.assets as LocalAssetRow[]) : [],
    images: isObj(data.images) ? (data.images as Record<string, { mime: string }>) : {},
  };
}

async function readLocalStore(): Promise<LocalStore> {
  try {
    const raw = await readFile(LOCAL_STORE_FILE, "utf8");
    return normalizeLocalStore(JSON.parse(raw));
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") return defaultLocalStore();
    throw e;
  }
}

async function writeLocalStore(store: LocalStore): Promise<void> {
  await mkdir(LOCAL_STORE_DIR, { recursive: true });
  const tmp = `${LOCAL_STORE_FILE}.tmp`;
  await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tmp, LOCAL_STORE_FILE);
}

async function withLocalLock<T>(fn: () => Promise<T>): Promise<T> {
  const g = globalThis as typeof globalThis & { __stockmetaLocalStoreQueue?: Promise<void> };
  const prev = g[LOCAL_QUEUE_KEY] ?? Promise.resolve();
  let release!: () => void;
  g[LOCAL_QUEUE_KEY] = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
  }
}

async function mutateLocalStore<T>(fn: (store: LocalStore) => Promise<T>): Promise<T> {
  return withLocalLock(async () => {
    const store = await readLocalStore();
    const result = await fn(store);
    await writeLocalStore(store);
    return result;
  });
}

function toAssetRow(record: LocalAssetRow): AssetRow {
  return {
    ...record,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function fromAssetRow(row: AssetRow): LocalAssetRow {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function omitRaw(row: AssetRow): AssetListRow {
  const { rawResult: _raw, ...rest } = row;
  return rest;
}

function toProviderRow(record: LocalProviderRow): ProviderRow {
  return {
    id: record.id,
    apiKey: typeof record.apiKey === "string" ? record.apiKey : null,
    baseUrl: typeof record.baseUrl === "string" ? record.baseUrl : null,
    model: typeof record.model === "string" ? record.model : null,
    wireFormat: typeof record.wireFormat === "string" ? record.wireFormat : null,
    enabled: record.enabled !== false,
    options: isObj(record.options) ? record.options : {},
    updatedAt: new Date(record.updatedAt || nowIso()),
  };
}

function fromProviderRow(row: ProviderRow): LocalProviderRow {
  return {
    ...row,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toSettingsRow(record: LocalSettingsRow | undefined): SettingsRow | undefined {
  if (!record) return undefined;
  return {
    id: record.id === 1 ? 1 : 1,
    activeProviderId: typeof record.activeProviderId === "string" ? record.activeProviderId : DEFAULT_PROVIDER_ID,
    platforms: Array.isArray(record.platforms) ? record.platforms.filter((x): x is string => typeof x === "string") : [],
    defaultHint: typeof record.defaultHint === "string" ? record.defaultHint : "auto",
    concurrency: Number.isInteger(record.concurrency) ? record.concurrency : 3,
    updatedAt: new Date(record.updatedAt || nowIso()),
  };
}

function fromSettingsDTO(dto: AppSettingsDTO): LocalSettingsRow {
  return {
    id: 1,
    activeProviderId: dto.activeProviderId,
    platforms: [...dto.platforms],
    defaultHint: dto.defaultHint,
    concurrency: dto.concurrency,
    updatedAt: nowIso(),
  };
}

function normalizeSettings(row: SettingsRow | undefined): AppSettingsDTO {
  const active = row && getProviderDef(row.activeProviderId) ? row.activeProviderId : DEFAULT_PROVIDER_ID;
  const platforms = Array.isArray(row?.platforms) ? row.platforms.filter(isPlatformId) : [];
  return {
    activeProviderId: active,
    platforms: platforms.length ? platforms : [...PLATFORM_IDS],
    defaultHint: isHint(row?.defaultHint) ? row.defaultHint : "auto",
    concurrency: Math.min(8, Math.max(1, row?.concurrency ?? 3)),
  };
}

function buildAssetRow(
  id: string,
  data: Pick<AssetInsert, "filename" | "width" | "height" | "hint" | "fileType" | "vectorCompanion">,
  createdAt = new Date(),
): AssetRow {
  return {
    id,
    filename: data.filename ?? "image.jpg",
    width: data.width ?? 0,
    height: data.height ?? 0,
    hint: isHint(data.hint) ? data.hint : "auto",
    status: "pending",
    error: null,
    providerId: null,
    model: null,
    result: null,
    rawResult: null,
    issues: [],
    fileType: data.fileType ?? null,
    vectorCompanion: data.vectorCompanion ?? null,
    usage: null,
    createdAt,
    updatedAt: createdAt,
  };
}

// List queries never load the raw model JSON (kept only for audit / acceptance checks).
const { rawResult: _omitRaw, ...listColumns } = getTableColumns(assets);

export async function listAssets(): Promise<AssetDTO[]> {
  if (storageMode() === "local") {
    const store = await readLocalStore();
    return store.assets.map(toAssetRow).sort(byCreated).map((row) => toAssetDTO(omitRaw(row)));
  }
  await ensureSchema();
  const db = getDb();
  if (!db) return [];
  const rows = await db.select(listColumns).from(assets).orderBy(asc(assets.createdAt), asc(assets.id));
  return rows.map(toAssetDTO);
}

export async function getAssetsByIds(ids: string[]): Promise<AssetDTO[]> {
  const valid = ids.filter((id) => UUID_RE.test(id));
  if (!valid.length) return [];
  if (storageMode() === "local") {
    const wanted = new Set(valid);
    const store = await readLocalStore();
    return store.assets
      .map(toAssetRow)
      .filter((row) => wanted.has(row.id))
      .sort(byCreated)
      .map((row) => toAssetDTO(omitRaw(row)));
  }
  await ensureSchema();
  const db = getDb();
  if (!db) return [];
  const rows = await db
    .select(listColumns)
    .from(assets)
    .where(inArray(assets.id, valid))
    .orderBy(asc(assets.createdAt), asc(assets.id));
  return rows.map(toAssetDTO);
}

export async function getAssetRow(id: string): Promise<AssetRow | null> {
  if (!UUID_RE.test(id)) return null;
  if (storageMode() === "local") {
    const store = await readLocalStore();
    const row = store.assets.find((asset) => asset.id === id);
    return row ? toAssetRow(row) : null;
  }
  await ensureSchema();
  const db = getDb();
  if (!db) return null;
  const rows = await db.select().from(assets).where(eq(assets.id, id));
  return rows[0] ?? null;
}

export async function createAsset(
  data: Pick<AssetInsert, "filename" | "width" | "height" | "hint" | "fileType" | "vectorCompanion">,
  images: { mime: string; thumb: Buffer; analysis: Buffer },
): Promise<AssetDTO> {
  if (storageMode() === "local") {
    return mutateLocalStore(async (store) => {
      const row = buildAssetRow(randomUUID(), data);
      await mkdir(localImageDir(row.id), { recursive: true });
      await Promise.all([
        writeFile(localThumbPath(row.id), images.thumb),
        writeFile(localAnalysisPath(row.id), images.analysis),
      ]);
      store.assets.push(fromAssetRow(row));
      store.images[row.id] = { mime: images.mime || "image/jpeg" };
      return toAssetDTO(omitRaw(row));
    });
  }
  await ensureSchema();
  const db = getDb();
  if (!db) throw new Error("Database is not configured");
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(assets).values(data).returning();
    await tx.insert(assetImages).values({ assetId: row.id, ...images });
    return toAssetDTO(row);
  });
}

export async function updateAssetRow(id: string, patch: Partial<AssetInsert>): Promise<AssetDTO | null> {
  if (!UUID_RE.test(id)) return null;
  if (storageMode() === "local") {
    return mutateLocalStore(async (store) => {
      const index = store.assets.findIndex((asset) => asset.id === id);
      if (index === -1) return null;
      const current = toAssetRow(store.assets[index]);
      const next: AssetRow = {
        ...current,
        ...patch,
        updatedAt: new Date(),
      };
      store.assets[index] = fromAssetRow(next);
      return toAssetDTO(omitRaw(next));
    });
  }
  await ensureSchema();
  const db = getDb();
  if (!db) return null;
  const rows = await db
    .update(assets)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(assets.id, id))
    .returning();
  return rows[0] ? toAssetDTO(rows[0]) : null;
}

export async function deleteAssets(ids: string[] | "all"): Promise<number> {
  if (storageMode() === "local") {
    return mutateLocalStore(async (store) => {
      if (ids === "all") {
        const count = store.assets.length;
        store.assets = [];
        store.images = {};
        await rm(LOCAL_IMAGES_DIR, { recursive: true, force: true });
        return count;
      }
      const valid = ids.filter((id) => UUID_RE.test(id));
      if (!valid.length) return 0;
      const wanted = new Set(valid);
      const removed = store.assets.filter((asset) => wanted.has(asset.id)).map((asset) => asset.id);
      if (!removed.length) return 0;
      store.assets = store.assets.filter((asset) => !wanted.has(asset.id));
      for (const id of removed) {
        delete store.images[id];
        await rm(localImageDir(id), { recursive: true, force: true });
      }
      return removed.length;
    });
  }
  await ensureSchema();
  const db = getDb();
  if (!db) return 0;
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
  if (storageMode() === "local") {
    const store = await readLocalStore();
    const meta = store.images[id];
    if (!meta) return null;
    try {
      const data = await readFile(kind === "thumb" ? localThumbPath(id) : localAnalysisPath(id));
      return { data, mime: meta.mime || "image/jpeg" };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err?.code === "ENOENT") return null;
      throw e;
    }
  }
  await ensureSchema();
  const db = getDb();
  if (!db) return null;
  const rows = await db
    .select({ data: kind === "thumb" ? assetImages.thumb : assetImages.analysis, mime: assetImages.mime })
    .from(assetImages)
    .where(eq(assetImages.assetId, id));
  return rows[0] ?? null;
}

/* ---------------- settings ---------------- */
export async function getSettings(): Promise<AppSettingsDTO> {
  if (storageMode() === "local") {
    const store = await readLocalStore();
    return normalizeSettings(toSettingsRow(store.settings));
  }
  await ensureSchema();
  const db = getDb();
  if (!db) return normalizeSettings(undefined);
  let rows = await db.select().from(appSettings).where(eq(appSettings.id, 1));
  if (!rows[0]) {
    await db.insert(appSettings).values({ id: 1 }).onConflictDoNothing();
    rows = await db.select().from(appSettings).where(eq(appSettings.id, 1));
  }
  return normalizeSettings(rows[0]);
}

export async function updateSettings(patch: Partial<AppSettingsDTO>): Promise<AppSettingsDTO> {
  if (storageMode() === "local") {
    return mutateLocalStore(async (store) => {
      const next = { ...normalizeSettings(toSettingsRow(store.settings)), ...patch };
      store.settings = fromSettingsDTO(normalizeSettings({
        id: 1,
        activeProviderId: next.activeProviderId,
        platforms: next.platforms,
        defaultHint: next.defaultHint,
        concurrency: next.concurrency,
        updatedAt: new Date(),
      }));
      return normalizeSettings(toSettingsRow(store.settings));
    });
  }
  await getSettings();
  const db = getDb();
  if (!db) return normalizeSettings(undefined);
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
  if (storageMode() === "local") {
    const store = await readLocalStore();
    return Object.values(store.providers).map(toProviderRow);
  }
  await ensureSchema();
  const db = getDb();
  if (!db) return [];
  return db.select().from(providerSettings);
}

export async function getProviderRow(id: string): Promise<ProviderRow | null> {
  if (storageMode() === "local") {
    const store = await readLocalStore();
    const row = store.providers[id];
    return row ? toProviderRow(row) : null;
  }
  await ensureSchema();
  const db = getDb();
  if (!db) return null;
  const rows = await db.select().from(providerSettings).where(eq(providerSettings.id, id));
  return rows[0] ?? null;
}

export async function upsertProviderRow(
  id: string,
  patch: Partial<Omit<typeof providerSettings.$inferInsert, "id">>,
): Promise<ProviderRow> {
  if (storageMode() === "local") {
    return mutateLocalStore(async (store) => {
      const current = store.providers[id] ? toProviderRow(store.providers[id]) : null;
      const next: ProviderRow = {
        id,
        apiKey: patch.apiKey !== undefined ? patch.apiKey ?? null : current?.apiKey ?? null,
        baseUrl: patch.baseUrl !== undefined ? patch.baseUrl ?? null : current?.baseUrl ?? null,
        model: patch.model !== undefined ? patch.model ?? null : current?.model ?? null,
        wireFormat: patch.wireFormat !== undefined ? patch.wireFormat ?? null : current?.wireFormat ?? null,
        enabled: patch.enabled !== undefined ? patch.enabled : current?.enabled ?? true,
        options: patch.options !== undefined ? (patch.options as Record<string, unknown>) : current?.options ?? {},
        updatedAt: new Date(),
      };
      store.providers[id] = fromProviderRow(next);
      return next;
    });
  }
  await ensureSchema();
  const db = getDb();
  if (!db) throw new Error("Database is not configured");
  const rows = await db
    .insert(providerSettings)
    .values({ id, ...patch, updatedAt: new Date() })
    .onConflictDoUpdate({ target: providerSettings.id, set: { ...patch, updatedAt: new Date() } })
    .returning();
  return rows[0];
}
