import { getProviderDef } from "@/lib/providers/registry";
import { getProviderState, isWireFormat } from "@/lib/server/providers";
import { upsertProviderRow } from "@/lib/server/repo";
import { errMessage, jsonError, readJson, type IdContext } from "@/lib/server/http";

export const dynamic = "force-dynamic";

function optionalText(v: unknown, field: string, max = 500): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") throw new Error(`${field} must be a string`);
  const t = v.trim();
  if (t.length > max) throw new Error(`${field} is too long`);
  return t || null;
}

export async function GET(_req: Request, ctx: IdContext) {
  const { id } = await ctx.params;
  const state = await getProviderState(id);
  return state ? Response.json({ provider: state }) : jsonError("Unknown provider", 404);
}

export async function PUT(req: Request, ctx: IdContext) {
  const { id } = await ctx.params;
  const def = getProviderDef(id);
  if (!def) return jsonError("Unknown provider", 404);
  const body = await readJson(req);
  try {
    const patch: Parameters<typeof upsertProviderRow>[1] = {};
    const apiKey = optionalText(body.apiKey, "apiKey", 4000);
    if (apiKey !== undefined) patch.apiKey = apiKey;
    const baseUrl = optionalText(body.baseUrl, "baseUrl");
    if (baseUrl !== undefined) {
      if (baseUrl && !/^https?:\/\/[^\s]+$/i.test(baseUrl)) throw new Error("Base URL must start with http:// or https://");
      patch.baseUrl = baseUrl ? baseUrl.replace(/\/+$/, "") : null;
    }
    const model = optionalText(body.model, "model", 200);
    if (model !== undefined) patch.model = model;
    if (body.wireFormat !== undefined) {
      if (!def.wireFormatEditable) patch.wireFormat = null;
      else if (body.wireFormat === null || body.wireFormat === "") patch.wireFormat = null;
      else if (isWireFormat(body.wireFormat)) patch.wireFormat = body.wireFormat;
      else throw new Error("Unknown wire format");
    }
    if (body.enabled !== undefined) patch.enabled = body.enabled === true;
    if (body.options !== undefined) {
      const o = (body.options && typeof body.options === "object" ? body.options : {}) as Record<string, unknown>;
      patch.options = def.supportsThinkingToggle ? { thinking: o.thinking === true } : {};
    }
    await upsertProviderRow(id, patch);
    return Response.json({ provider: await getProviderState(id) });
  } catch (e) {
    return jsonError(errMessage(e), 400);
  }
}
