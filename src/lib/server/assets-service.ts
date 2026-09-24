import { getProviderDef } from "@/lib/providers/registry";
import { applyFileTypeDecision, validateResult } from "@/lib/validation";
import {
  PLATFORM_IDS,
  isContentType,
  isHint,
  type AssetDTO,
  type ContentTypeHint,
  type FileTypeDecision,
  type Issue,
  type MetadataResult,
  type PlatformId,
} from "@/lib/types";
import { FATAL_CODES, toProviderError } from "./errors";
import { generateMetadata } from "./generate";
import { getAssetImage, getAssetRow, getSettings, updateAssetRow, type AssetInsert } from "./repo";

export class NotFoundError extends Error {}

export async function runGeneration(
  id: string,
  opts: { providerId?: string; platforms?: PlatformId[] },
): Promise<{ asset: AssetDTO; errorCode?: string; retryable?: boolean; fatal?: boolean }> {
  const row = await getAssetRow(id);
  if (!row) throw new NotFoundError("Asset not found");
  const img = await getAssetImage(id, "analysis");
  if (!img) throw new NotFoundError("Asset image not found");
  const settings = await getSettings();
  const providerId = opts.providerId && getProviderDef(opts.providerId) ? opts.providerId : settings.activeProviderId;
  const platforms = opts.platforms?.length ? opts.platforms : settings.platforms;

  await updateAssetRow(id, { status: "processing", error: null });
  try {
    const out = await generateMetadata({
      providerId,
      image: { base64: img.data.toString("base64"), mime: img.mime },
      filename: row.filename,
      width: row.width,
      height: row.height,
      hint: isHint(row.hint) ? row.hint : "auto",
      platforms,
      fileType: row.fileType === "vector" || row.fileType === "raster" ? row.fileType : null,
      vectorCompanion: row.vectorCompanion,
    });
    const firstError = out.issues.find((i) => i.level === "error")?.message ?? "The model output could not be validated";
    const asset = await updateAssetRow(id, {
      status: out.result ? "done" : "error",
      result: out.result,
      rawResult: out.raw ?? null,
      issues: out.issues,
      providerId,
      model: out.model,
      usage: out.usage,
      error: out.result ? null : firstError,
    });
    if (!asset) throw new NotFoundError("Asset was deleted during generation");
    return { asset };
  } catch (e) {
    if (e instanceof NotFoundError) throw e;
    const pe = toProviderError(e);
    const asset = await updateAssetRow(id, { status: "error", error: pe.message, providerId });
    if (!asset) throw new NotFoundError("Asset was deleted during generation");
    return { asset, errorCode: pe.code, retryable: pe.retryable, fatal: FATAL_CODES.includes(pe.code) };
  }
}

export interface AssetPatch {
  hint?: ContentTypeHint;
  fileType?: FileTypeDecision | null;
  result?: unknown;
}

export function parseAssetPatch(body: unknown): AssetPatch {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const patch: AssetPatch = {};
  if (b.hint !== undefined) {
    if (!isHint(b.hint)) throw new Error("hint must be auto | single_asset | template_pack");
    patch.hint = b.hint;
  }
  if (b.fileType !== undefined) {
    if (b.fileType !== null && b.fileType !== "vector" && b.fileType !== "raster") throw new Error("fileType must be vector | raster | null");
    patch.fileType = b.fileType;
  }
  if (b.result !== undefined) patch.result = b.result;
  return patch;
}

/** Applies user changes. Edits are re-validated strictly but never rewritten (autofix off). */
export async function patchAsset(id: string, patch: AssetPatch): Promise<AssetDTO | null> {
  const row = await getAssetRow(id);
  if (!row) return null;
  const update: Partial<AssetInsert> = {};
  let result: MetadataResult | null = row.result ?? null;
  let fileType: FileTypeDecision | null = row.fileType === "vector" || row.fileType === "raster" ? row.fileType : null;
  let notes: Issue[] = [];
  let revalidate = false;

  if (patch.hint !== undefined) update.hint = patch.hint;

  if (patch.result !== undefined && patch.result !== null) {
    const ct = (patch.result as { content_type?: unknown }).content_type;
    const keys = Object.keys(((patch.result as { platforms?: object }).platforms ?? {}) as object);
    const platforms = PLATFORM_IDS.filter((p) => keys.includes(p));
    const v = validateResult(
      patch.result,
      {
        hint: isContentType(ct) ? ct : (result?.content_type ?? "auto"),
        platforms,
        fileType,
        width: row.width,
        height: row.height,
      },
      { final: true, autofix: false },
    );
    if (!v.result) throw new Error(v.issues[0]?.message ?? "Invalid metadata");
    result = v.result;
    revalidate = true;
  }

  if (patch.fileType !== undefined) {
    fileType = patch.fileType;
    update.fileType = fileType;
    if (result && fileType) {
      const t = applyFileTypeDecision(result, fileType);
      result = t.result;
      notes = t.changes.map((message) => ({ level: "fixed" as const, rule: "K", message }));
    }
    revalidate = !!result;
  }

  if (revalidate && result) {
    const platforms = PLATFORM_IDS.filter((p) => result?.platforms[p]);
    const v = validateResult(
      result,
      { hint: result.content_type, platforms, fileType, width: row.width, height: row.height },
      { final: true, autofix: false },
    );
    update.result = v.result;
    update.issues = [...notes, ...v.issues];
  }
  return updateAssetRow(id, update);
}
