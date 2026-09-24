import { listProviderStates } from "@/lib/server/providers";
import { getSettings } from "@/lib/server/repo";
import { errMessage, jsonError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [providers, settings] = await Promise.all([listProviderStates(), getSettings()]);
    return Response.json({ providers, activeProviderId: settings.activeProviderId });
  } catch (e) {
    return jsonError(errMessage(e), 500);
  }
}
