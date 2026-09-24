import { getProviderState, } from "@/lib/server/providers";
import { getSettings } from "@/lib/server/repo";
import type { ConnectivityDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Cheap reachability probe of the active provider's base URL. Any HTTP response
 *  (even 404/405) counts as reachable; only network-level failures don't. Cached for
 *  30s per host so the dashboard isn't probing on every interaction. */
const CACHE_TTL_MS = 30_000;
const g = globalThis as typeof globalThis & { __stockmetaProbeCache?: Map<string, { at: number; reachable: boolean }> };
const cache = (g.__stockmetaProbeCache ??= new Map());

async function probe(baseUrl: string): Promise<boolean> {
  try {
    await fetch(baseUrl, { method: "HEAD", signal: AbortSignal.timeout(2500), cache: "no-store" });
    return true;
  } catch {
    // Some servers reject HEAD outright — a GET that gets cut off still proves routing works.
    try {
      await fetch(baseUrl, { method: "GET", signal: AbortSignal.timeout(2500), cache: "no-store", headers: { range: "bytes=0-0" } });
      return true;
    } catch {
      return false;
    }
  }
}

export async function GET() {
  const settings = await getSettings();
  const state = await getProviderState(settings.activeProviderId);
  const baseUrl = state?.baseUrl ?? "";
  let host: string | null = null;
  try {
    host = baseUrl ? new URL(baseUrl).host : null;
  } catch {
    host = null;
  }
  if (!host) {
    const out: ConnectivityDTO = { host: null, reachable: null };
    return Response.json(out);
  }
  const cached = cache.get(host);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return Response.json({ host, reachable: cached.reachable } satisfies ConnectivityDTO);
  }
  const reachable = await probe(baseUrl);
  cache.set(host, { at: Date.now(), reachable });
  return Response.json({ host, reachable } satisfies ConnectivityDTO);
}
