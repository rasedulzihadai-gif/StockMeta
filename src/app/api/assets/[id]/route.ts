import { deleteAssets, getAssetRow, toAssetDTO } from "@/lib/server/repo";
import { parseAssetPatch, patchAsset } from "@/lib/server/assets-service";
import { errMessage, jsonError, readJson, type IdContext } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: IdContext) {
  const { id } = await ctx.params;
  const row = await getAssetRow(id);
  if (!row) return jsonError("Not found", 404);
  const { rawResult, ...rest } = row;
  return Response.json({ asset: toAssetDTO(rest), raw: rawResult ?? null });
}

export async function PATCH(req: Request, ctx: IdContext) {
  const { id } = await ctx.params;
  try {
    const asset = await patchAsset(id, parseAssetPatch(await readJson(req)));
    return asset ? Response.json({ asset }) : jsonError("Not found", 404);
  } catch (e) {
    return jsonError(errMessage(e), 400);
  }
}

export async function DELETE(_req: Request, ctx: IdContext) {
  const { id } = await ctx.params;
  const n = await deleteAssets([id]);
  return n ? Response.json({ deleted: n }) : jsonError("Not found", 404);
}
