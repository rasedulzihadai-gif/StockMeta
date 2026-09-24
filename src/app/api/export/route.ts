import { DEFAULT_EXPORT_OPTIONS, buildCsv, type ExportOptions, type QuoteChar } from "@/lib/csv";
import { getAssetsByIds, listAssets } from "@/lib/server/repo";
import { errMessage, jsonError, readJson } from "@/lib/server/http";
import { isPlatformId } from "@/lib/types";

export const dynamic = "force-dynamic";

/** POST { platform, ids?, options? } → { filename, content, rows, warnings, skipped, renamed } */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (!isPlatformId(body.platform)) return jsonError("platform must be adobe | shutterstock | freepik | istock");
  const o = (body.options && typeof body.options === "object" ? body.options : {}) as Record<string, unknown>;
  const quote = o.freepikQuote;
  const options: ExportOptions = {
    adobeCapFilenames: typeof o.adobeCapFilenames === "boolean" ? o.adobeCapFilenames : DEFAULT_EXPORT_OPTIONS.adobeCapFilenames,
    useVectorSourceName:
      typeof o.useVectorSourceName === "boolean" ? o.useVectorSourceName : DEFAULT_EXPORT_OPTIONS.useVectorSourceName,
    freepikQuote: quote === "'" || quote === '"' || quote === "" ? (quote as QuoteChar) : DEFAULT_EXPORT_OPTIONS.freepikQuote,
    freepikModel: typeof o.freepikModel === "string" ? o.freepikModel.slice(0, 100) : "",
  };
  try {
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : null;
    const assets = ids ? await getAssetsByIds(ids) : await listAssets();
    return Response.json(buildCsv(body.platform, assets, options));
  } catch (e) {
    return jsonError(errMessage(e), 500);
  }
}
