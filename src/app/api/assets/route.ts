import { createAsset, deleteAssets, listAssets } from "@/lib/server/repo";
import { parseAssetPatch, patchAsset } from "@/lib/server/assets-service";
import { errMessage, jsonError, readJson } from "@/lib/server/http";
import { isHint, type AssetDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX_ANALYSIS_BYTES = 12 * 1024 * 1024;
const MAX_THUMB_BYTES = 2 * 1024 * 1024;

export async function GET() {
  try {
    return Response.json({ assets: await listAssets() });
  } catch (e) {
    return jsonError(errMessage(e), 500);
  }
}

/** Upload: multipart with a downscaled analysis JPEG + thumbnail produced in the browser. */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError("Expected multipart/form-data");
  }
  const analysis = form.get("analysis");
  const thumb = form.get("thumb");
  if (!(analysis instanceof Blob) || !(thumb instanceof Blob)) return jsonError("analysis and thumb images are required");
  if (analysis.size > MAX_ANALYSIS_BYTES || thumb.size > MAX_THUMB_BYTES) return jsonError("Image too large", 413);
  const mime = analysis.type && analysis.type.startsWith("image/") ? analysis.type : "image/jpeg";
  const filename = String(form.get("filename") ?? "image.jpg").trim().slice(0, 255) || "image.jpg";
  const width = Math.max(0, Math.min(100_000, parseInt(String(form.get("width") ?? "0"), 10) || 0));
  const height = Math.max(0, Math.min(100_000, parseInt(String(form.get("height") ?? "0"), 10) || 0));
  const hintRaw = form.get("hint");
  const fileTypeRaw = form.get("fileType");
  const companion = String(form.get("vectorCompanion") ?? "").trim().slice(0, 255);
  try {
    const asset = await createAsset(
      {
        filename,
        width,
        height,
        hint: isHint(hintRaw) ? hintRaw : "auto",
        fileType: fileTypeRaw === "vector" || fileTypeRaw === "raster" ? fileTypeRaw : null,
        vectorCompanion: companion || null,
      },
      {
        mime,
        analysis: Buffer.from(await analysis.arrayBuffer()),
        thumb: Buffer.from(await thumb.arrayBuffer()),
      },
    );
    return Response.json({ asset }, { status: 201 });
  } catch (e) {
    return jsonError(errMessage(e), 500);
  }
}

/** Bulk patch: { ids, hint?, fileType? } */
export async function PATCH(req: Request) {
  const body = await readJson(req);
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 5000) : [];
  if (!ids.length) return jsonError("ids required");
  try {
    const patch = parseAssetPatch({ hint: body.hint, fileType: body.fileType });
    const out: AssetDTO[] = [];
    for (const id of ids) {
      const a = await patchAsset(id, patch);
      if (a) out.push(a);
    }
    return Response.json({ assets: out });
  } catch (e) {
    return jsonError(errMessage(e), 400);
  }
}

/** Bulk delete: { ids } or { all: true } */
export async function DELETE(req: Request) {
  const body = await readJson(req);
  try {
    if (body.all === true) return Response.json({ deleted: await deleteAssets("all") });
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
    if (!ids.length) return jsonError("ids required");
    return Response.json({ deleted: await deleteAssets(ids) });
  } catch (e) {
    return jsonError(errMessage(e), 500);
  }
}
