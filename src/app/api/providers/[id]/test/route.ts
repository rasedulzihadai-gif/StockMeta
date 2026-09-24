import { testProviderConnection } from "@/lib/server/adapters";
import { toProviderError } from "@/lib/server/errors";
import { resolveProviderConfig } from "@/lib/server/providers";
import type { IdContext } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: IdContext) {
  const { id } = await ctx.params;
  try {
    const cfg = await resolveProviderConfig(id);
    return Response.json(await testProviderConnection(cfg));
  } catch (e) {
    const pe = toProviderError(e);
    return Response.json({ ok: false, error: pe.message, code: pe.code });
  }
}
