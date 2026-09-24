import { NotFoundError, runGeneration } from "@/lib/server/assets-service";
import { errMessage, jsonError, readJson, type IdContext } from "@/lib/server/http";
import { isPlatformId } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request, ctx: IdContext) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  const platforms = Array.isArray(body.platforms) ? body.platforms.filter(isPlatformId) : undefined;
  try {
    const out = await runGeneration(id, {
      providerId: typeof body.providerId === "string" ? body.providerId : undefined,
      platforms,
    });
    return Response.json(out);
  } catch (e) {
    if (e instanceof NotFoundError) return jsonError(e.message, 404);
    return jsonError(errMessage(e), 500);
  }
}
