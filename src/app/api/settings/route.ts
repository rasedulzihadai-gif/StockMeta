import { getProviderDef } from "@/lib/providers/registry";
import { getSettings, updateSettings } from "@/lib/server/repo";
import { errMessage, jsonError, readJson } from "@/lib/server/http";
import { isHint, isPlatformId, type AppSettingsDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ settings: await getSettings() });
  } catch (e) {
    return jsonError(errMessage(e), 500);
  }
}

export async function PUT(req: Request) {
  const body = await readJson(req);
  const patch: Partial<AppSettingsDTO> = {};
  if (body.activeProviderId !== undefined) {
    if (typeof body.activeProviderId !== "string" || !getProviderDef(body.activeProviderId))
      return jsonError("Unknown provider");
    patch.activeProviderId = body.activeProviderId;
  }
  if (body.platforms !== undefined) {
    const list = Array.isArray(body.platforms) ? body.platforms.filter(isPlatformId) : [];
    if (!list.length) return jsonError("Select at least one platform");
    patch.platforms = Array.from(new Set(list));
  }
  if (body.defaultHint !== undefined) {
    if (!isHint(body.defaultHint)) return jsonError("defaultHint must be auto | single_asset | template_pack");
    patch.defaultHint = body.defaultHint;
  }
  if (body.concurrency !== undefined) {
    const n = Number(body.concurrency);
    if (!Number.isInteger(n) || n < 1 || n > 8) return jsonError("concurrency must be 1–8");
    patch.concurrency = n;
  }
  try {
    return Response.json({ settings: await updateSettings(patch) });
  } catch (e) {
    return jsonError(errMessage(e), 500);
  }
}
