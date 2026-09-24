import { readFile } from "node:fs/promises";
import path from "node:path";
import { SAMPLE_IMAGES, acceptanceChecks, casePassed, type SelfTestCase, type SelfTestReport } from "@/lib/acceptance";
import { getProviderDef } from "@/lib/providers/registry";
import { toProviderError } from "@/lib/server/errors";
import { generateMetadata } from "@/lib/server/generate";
import { sniffImage } from "@/lib/server/image-size";
import { resolveProviderConfig } from "@/lib/server/providers";
import { getSettings } from "@/lib/server/repo";
import { jsonError, readJson } from "@/lib/server/http";
import { PLATFORM_IDS } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Runs the two bundled genuine test images (one single background, one poster
 * template pack) through the selected provider in AUTO mode with neutral
 * filenames, and scores raw + validated output against the acceptance criteria.
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  const settings = await getSettings();
  const providerId =
    typeof body.providerId === "string" && getProviderDef(body.providerId) ? body.providerId : settings.activeProviderId;
  let label = providerId;
  let model = "";
  try {
    const cfg = await resolveProviderConfig(providerId);
    label = cfg.label;
    model = cfg.model;
  } catch (e) {
    return jsonError(toProviderError(e).message, 400);
  }

  const cases: SelfTestCase[] = await Promise.all(
    SAMPLE_IMAGES.map(async (s): Promise<SelfTestCase> => {
      const t0 = Date.now();
      try {
        const buf = await readFile(path.join(process.cwd(), "public", "samples", s.file));
        const info = sniffImage(buf);
        const out = await generateMetadata({
          providerId,
          image: { base64: buf.toString("base64"), mime: info?.mime ?? "image/jpeg" },
          filename: s.neutralName,
          width: info?.width ?? 0,
          height: info?.height ?? 0,
          hint: "auto",
          platforms: PLATFORM_IDS,
          fileType: null,
          vectorCompanion: null,
        });
        const rawChecks = acceptanceChecks(s.expected, out.raw);
        const finalChecks = acceptanceChecks(s.expected, out.result);
        return {
          id: s.id,
          filename: s.file,
          expected: s.expected,
          ok: casePassed(rawChecks, finalChecks),
          error: null,
          modelContentType: out.modelContentType,
          rawChecks,
          finalChecks,
          result: out.result,
          issues: out.issues,
          latencyMs: Date.now() - t0,
          model: out.model,
        };
      } catch (e) {
        return {
          id: s.id,
          filename: s.file,
          expected: s.expected,
          ok: false,
          error: toProviderError(e).message,
          modelContentType: null,
          rawChecks: [],
          finalChecks: [],
          result: null,
          issues: [],
          latencyMs: Date.now() - t0,
          model: null,
        };
      }
    }),
  );

  const report: SelfTestReport = {
    providerId,
    providerLabel: label,
    model,
    ranAt: new Date().toISOString(),
    passed: cases.every((c) => c.ok),
    cases,
  };
  return Response.json(report);
}
