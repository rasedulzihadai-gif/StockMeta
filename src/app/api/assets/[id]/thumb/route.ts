import { getAssetImage } from "@/lib/server/repo";
import type { IdContext } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: IdContext) {
  const { id } = await ctx.params;
  const img = await getAssetImage(id, "thumb");
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(img.data), {
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=31536000, immutable" },
  });
}
