// Acceptance checks for the two content-type conventions. They run on BOTH the
// raw model output (what the model did on its own) and the validated output
// (after the strict validation layer), so auto-fixes can't mask model failures.

import type { ContentType, Issue, MetadataResult } from "./types";
import { COLLECTION_WORDING_RE, COLOR_WORDS, DESIGN_PURPOSE_POOL, FILLER_KEYWORDS } from "./lexicon";
import { countListedElements, findEditableTextClaims, hasColorWord, hasTemplateKindNoun } from "./validation";

export interface AcceptanceCheck {
  id: string;
  label: string;
  pass: boolean;
  critical: boolean;
  detail: string;
}

export interface SampleImage {
  id: "single" | "template";
  file: string;
  /** Neutral name sent to the model so the filename can't leak the answer. */
  neutralName: string;
  expected: ContentType;
  label: string;
  description: string;
}

export const SAMPLE_IMAGES: SampleImage[] = [
  {
    id: "single",
    file: "single-background.jpg",
    neutralName: "sample-1.jpg",
    expected: "single_asset",
    label: "Genuine single background",
    description: "One smooth gradient backdrop — nothing composed, no text.",
  },
  {
    id: "template",
    file: "template-pack.jpg",
    neutralName: "sample-2.jpg",
    expected: "template_pack",
    label: "Genuine poster template pack",
    description: "Several poster layouts with waves, spheres, mesh lines and placeholder text.",
  },
];

export interface SelfTestCase {
  id: SampleImage["id"];
  filename: string;
  expected: ContentType;
  ok: boolean;
  error: string | null;
  modelContentType: string | null;
  rawChecks: AcceptanceCheck[];
  finalChecks: AcceptanceCheck[];
  result: MetadataResult | null;
  issues: Issue[];
  latencyMs: number;
  model: string | null;
}

export interface SelfTestReport {
  providerId: string;
  providerLabel: string;
  model: string;
  ranAt: string;
  passed: boolean;
  cases: SelfTestCase[];
}

type Obj = Record<string, unknown>;
const get = (o: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Obj)[k] : undefined), o);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase().trim()).filter(Boolean)
    : typeof v === "string"
      ? v.split(",").map((x) => x.toLowerCase().trim()).filter(Boolean)
      : [];
const flagCodes = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map((f) => (typeof f === "string" ? f.split(/[:\s]/)[0] : str(get(f, "code"))).toUpperCase())
    : [];

const COLOR_SET = new Set(COLOR_WORDS);
const DESIGN_SET = new Set(DESIGN_PURPOSE_POOL);
const FILLER_SET = new Set(FILLER_KEYWORDS);

export function acceptanceChecks(expected: ContentType, output: unknown): AcceptanceCheck[] {
  const checks: AcceptanceCheck[] = [];
  const add = (id: string, label: string, pass: boolean, critical: boolean, detail: string) =>
    checks.push({ id, label, pass, critical, detail });

  const ct = str(get(output, "content_type"));
  const adobeTitle = str(get(output, "platforms", "adobe", "title"));
  const freepikTitle = str(get(output, "platforms", "freepik", "title"));
  const ssDesc = str(get(output, "platforms", "shutterstock", "description"));
  const istockTitle = str(get(output, "platforms", "istock", "title"));
  const istockDesc = str(get(output, "platforms", "istock", "description"));
  const mainTitle = adobeTitle || freepikTitle || istockTitle || ssDesc;
  const kwAdobe = list(get(output, "platforms", "adobe", "keywords"));
  const allKw = Array.from(
    new Set([
      ...kwAdobe,
      ...list(get(output, "platforms", "shutterstock", "keywords")),
      ...list(get(output, "platforms", "freepik", "keywords")),
      ...list(get(output, "platforms", "istock", "keywords")),
    ]),
  );
  const allText = [adobeTitle, freepikTitle, ssDesc, istockTitle, istockDesc, str(get(output, "description")), allKw.join(", ")]
    .join(" \n ")
    .toLowerCase();
  const flags = flagCodes(get(output, "flags"));
  const category = str(get(output, "category_suggestion"));
  const colorKw = allKw.filter((k) => k.split(/\s+/).some((w) => COLOR_SET.has(w)));
  const limitsOk = [adobeTitle, freepikTitle].filter(Boolean).every((t) => t.length <= 70) && !!mainTitle;

  add("type", `Classified as ${expected}`, ct === expected, true, ct ? `content_type = "${ct}"` : "content_type missing");

  if (expected === "template_pack") {
    const n = countListedElements(mainTitle);
    add("h_elements", "Title lists 2–4 contained elements (rule H)", n >= 2 && n <= 4, true, `${n} element(s) in “${mainTitle || "—"}”`);
    add("h_kind", "Title names the kind of templates (rule H)", !!mainTitle && hasTemplateKindNoun(mainTitle), true, mainTitle || "—");
    add("h_limit", "Adobe / Freepik titles ≤ 70 characters (G limits kept)", limitsOk, true, `${adobeTitle.length} / ${freepikTitle.length} characters`);
    add("k_category", 'category_suggestion = "Graphic Resources" (rule K)', /^graphic resources$/i.test(category), true, `“${category || "—"}”`);
    const adobeCat = get(output, "platforms", "adobe", "category");
    add("k_adobe", "Adobe category 8 · Graphic Resources (rule K)", Number(adobeCat) === 8, false, String(adobeCat ?? "—"));
    const ssCats = list(get(output, "platforms", "shutterstock", "categories"));
    add("k_ss", 'Shutterstock categories avoid "Backgrounds/Textures" (rule K)', !ssCats.some((c) => c.includes("backgrounds")), false, ssCats.join(", ") || "—");
    const textPresent =
      flags.includes("CONTAINS_TEXT") ||
      /\b(replaceable|editable)\s+(text|headline|typography|font)/.test(allText) ||
      /\b(placeholder text|lorem ipsum|headline|typography)\b/.test(allText);
    const editable = findEditableTextClaims(allText);
    const replaceable = /\breplaceable\b/.test(allText);
    add(
      "j_replaceable",
      '"Replaceable text", never "editable text" (rule J)',
      textPresent ? editable.length === 0 && replaceable : editable.length === 0,
      true,
      textPresent
        ? editable.length
          ? `found: ${Array.from(new Set(editable)).join(", ")}`
          : replaceable
            ? '"replaceable text" used'
            : 'text present but "replaceable" never used'
        : "no text detected in the image",
    );
    const design = allKw.filter((k) => DESIGN_SET.has(k));
    add("i_design", "Design-purpose keywords present (rule I)", design.length >= 3, true, design.slice(0, 8).join(", ") || "none");
    add("a_colors", "Color keywords still present (rule A)", colorKw.length >= 1, false, colorKw.slice(0, 6).join(", ") || "none");
    add("k_vector", "POSSIBLE_VECTOR flag raised for file-type confirmation (rule K)", flags.includes("POSSIBLE_VECTOR"), false, flags.join(", ") || "no flags");
  } else {
    add("g_literal", "Title describes one visual — no collection wording (rule G)", !!mainTitle && !COLLECTION_WORDING_RE.test(mainTitle), true, `“${mainTitle || "—"}”`);
    add("g_limit", "Adobe / Freepik titles ≤ 70 characters (rule G)", limitsOk, true, `${adobeTitle.length} / ${freepikTitle.length} characters`);
    add("a_title_color", "Main color named in the title (rule A)", hasColorWord(mainTitle), true, mainTitle || "—");
    add("a_colors", "Color keywords present (rule A)", colorKw.length >= 2, true, colorKw.slice(0, 6).join(", ") || "none");
    const filler = allKw.filter((k) => FILLER_SET.has(k));
    add("c_filler", "No filler keywords (rule C)", filler.length === 0, true, filler.join(", ") || "none");
    add("e_count", "Adobe keyword count 30–49 (rule E)", kwAdobe.length >= 30 && kwAdobe.length <= 49, false, `${kwAdobe.length} keywords`);
    add(
      "not_graphic_pack",
      "Template-only transforms not applied (no forced Graphic Resources / replaceable-text layer)",
      !(/^graphic resources$/i.test(category) && /\breplaceable text\b/.test(allText)),
      false,
      `category “${category || "—"}”`,
    );
  }
  return checks;
}

/** A case passes when the model classified it correctly on its own and every critical final check passes. */
export function casePassed(rawChecks: AcceptanceCheck[], finalChecks: AcceptanceCheck[]): boolean {
  const rawType = rawChecks.find((c) => c.id === "type");
  return !!rawType?.pass && finalChecks.length > 0 && finalChecks.every((c) => !c.critical || c.pass);
}
