// Strict output-field validation layer.
// - Model output (autofix: true): coerces, repairs and records every change as a "fixed" issue.
// - User edits  (autofix: false): never rewrites the user's wording, only reports warnings/errors.

import {
  CONTENT_TYPE_LABEL,
  FLAG_CODES,
  type AdobeMeta,
  type ContentType,
  type ContentTypeHint,
  type FileTypeDecision,
  type Flag,
  type FlagCode,
  type FreepikMeta,
  type IStockMeta,
  type Issue,
  type IssueLevel,
  type MetadataResult,
  type PlatformId,
  type PlatformsMeta,
  type ShutterstockMeta,
} from "./types";
import { ADOBE_CATEGORIES, PLATFORM_SPECS, SHUTTERSTOCK_CATEGORIES } from "./platforms";
import {
  COLLECTION_WORDING_RE,
  COLOR_WORDS,
  DESIGN_PURPOSE_POOL,
  FILLER_KEYWORDS,
  FILLER_PHRASE_WORDS,
  FILLER_TITLE_TERMS,
  IP_TERMS,
  IP_TITLE_TERMS,
  TEMPLATE_KIND_RE,
  USE_CASE_POOL,
} from "./lexicon";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const asString = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const uniq = <T,>(a: T[]): T[] => Array.from(new Set(a));
const cap1 = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const COLOR_SET = new Set<string>(COLOR_WORDS);
const USE_CASE_SET = new Set<string>(USE_CASE_POOL);
const DESIGN_SET = new Set<string>(DESIGN_PURPOSE_POOL);
const FILLER_KW_SET = new Set<string>(FILLER_KEYWORDS);
const FILLER_PHRASE_SET = new Set<string>(FILLER_PHRASE_WORDS);
const IP_SET = new Set<string>(IP_TERMS);
const REPEAT_IGNORE = new Set([
  "a", "an", "and", "the", "with", "for", "of", "in", "on", "to", "or", "at", "by", "from", "as", "into",
]);

/* ================================================================== */
/* JSON extraction                                                     */
/* ================================================================== */
export function extractJson(text: string): unknown {
  const src = (text ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!src) throw new Error("The model returned an empty response");
  const fence = src.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : src;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object found in the model output");
  const slice = body.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    const repaired = slice.replace(/,\s*([}\]])/g, "$1");
    try {
      return JSON.parse(repaired);
    } catch (e) {
      throw new Error(`Model output is not valid JSON (${(e as Error).message})`);
    }
  }
}

/* ================================================================== */
/* Text helpers                                                        */
/* ================================================================== */
export function cleanText(s: string): string {
  let t = s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/^["'“”‘’`]+/, "").replace(/["“”`]+$/, "").trim();
  t = t.replace(/\s+([,.;:!?])/g, "$1").replace(/,{2,}/g, ",");
  return cap1(t);
}

export function cleanTitle(s: string): string {
  let t = cleanText(s).replace(/[.!;:,]+$/, "").trim();
  t = t.replace(/^(?:an?|image of|photo of|picture of)\s+/i, "");
  return cap1(t);
}

function tidy(t: string): string {
  return cap1(
    t
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([,.;:])/g, "$1")
      .replace(/([,;:])\s*(?=[,;:.])/g, "")
      .replace(/^[\s,;:.\-–]+/, "")
      .replace(/[\s,;:\-–]+$/, "")
      .replace(/([.!?]\s+)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase())
      .trim(),
  );
}

function removeTerms(text: string, terms: string[]): { text: string; removed: string[] } {
  let t = text;
  const removed: string[] = [];
  for (const term of terms) {
    const re = new RegExp(`(^|[^\\w-])${escapeRe(term)}(?=$|[^\\w-])`, "gi");
    const next = t.replace(re, "$1");
    if (next !== t) {
      removed.push(term);
      t = next;
    }
  }
  return removed.length ? { text: tidy(t), removed } : { text, removed };
}

function trimDangling(s: string): string {
  let t = s.trim().replace(/[,;:\-–&]+$/, "").trim();
  const dangling = /\s+(and|with|for|of|in|on|the|a|an|to|featuring|or|&)$/i;
  while (dangling.test(t)) t = t.replace(dangling, "").trim().replace(/[,;:\-–&]+$/, "").trim();
  return t;
}

/** Shorten at a clause boundary (", ", " with ", " and ", …) instead of mid-phrase. */
export function smartShorten(s: string, max: number): string {
  if (s.length <= max) return s;
  const windowText = s.slice(0, max + 1);
  const seps = [", ", " and ", " with ", " for ", " featuring ", " & ", "; ", " - ", " – ", ". "];
  let best = -1;
  for (const sep of seps) {
    const i = windowText.lastIndexOf(sep);
    if (i > best && i >= max * 0.5) best = i;
  }
  let out: string;
  if (best > 0) out = s.slice(0, best);
  else {
    const sp = windowText.lastIndexOf(" ");
    out = windowText.slice(0, sp > 0 ? sp : max);
  }
  out = trimDangling(out);
  // "…with A, B" → "…with A and B" when it still fits.
  const wi = out.search(/\b(with|featuring)\b/i);
  if (wi >= 0) {
    const lastComma = out.lastIndexOf(", ");
    if (lastComma > wi && !/\band\b/i.test(out.slice(wi))) {
      const alt = `${out.slice(0, lastComma)} and ${out.slice(lastComma + 2)}`;
      if (alt.length <= max) out = alt;
    }
  }
  return out.length > max ? trimDangling(out.slice(0, max)) : out;
}

function repeatedWords(t: string): string[] {
  const counts = new Map<string, number>();
  for (const w of t.toLowerCase().split(/[^a-z0-9-]+/)) {
    if (w.length <= 2 || REPEAT_IGNORE.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([w]) => w);
}

export function hasColorWord(s: string): boolean {
  return s
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((w) => COLOR_SET.has(w));
}

export function hasTemplateKindNoun(title: string): boolean {
  return TEMPLATE_KIND_RE.test(title);
}

/** Heuristic count of distinct elements listed in a collection-style title (rule H). */
export function countListedElements(title: string): number {
  const t = title.toLowerCase();
  let seg: string;
  const m = t.match(/\b(?:with|featuring|including|containing)\b(.+)$/);
  if (m) seg = m[1];
  else {
    const k = t.search(TEMPLATE_KIND_RE);
    seg = k > 0 ? t.slice(0, k) : "";
  }
  seg = seg.replace(/\b(?:for|in|on)\b.*$/, "");
  return seg
    .split(/,|\band\b|&|\bplus\b|\//)
    .map((s) => s.trim())
    .filter((s) => /[a-z]{3,}/.test(s)).length;
}

export function designPurposeCount(keywords: string[]): number {
  return keywords.filter(
    (k) =>
      DESIGN_SET.has(k) ||
      /\b(templates?|posters?|layouts?|covers?|fliers?|flyers?|booklets?|banners?|brochures?|mockups?)\b/.test(k),
  ).length;
}

/* ---------- Rule J: "editable text" → "replaceable text" ---------- */
const EDITABLE_TEXT_RE =
  /\b(editable)(\s+)(text|texts|font|fonts|typography|type|headlines?|headings?|titles?|copy|lettering|captions?|wording|slogans?|labels?)\b/gi;
const TEXT_IS_EDITABLE_RE =
  /\b(text|texts|fonts?|typography|headlines?|titles?|copy|lettering)(\s+(?:is|are)\s+(?:fully\s+)?)(editable)\b/gi;

export function swapEditableText(s: string): { text: string; count: number } {
  let count = 0;
  let t = s.replace(EDITABLE_TEXT_RE, (_m, ed: string, sp: string, noun: string) => {
    count++;
    const n = /^(font|fonts|typography|type)$/i.test(noun) ? "text" : noun;
    const rep = `replaceable${sp}${n}`;
    return ed.charAt(0) === "E" ? cap1(rep) : rep;
  });
  t = t.replace(TEXT_IS_EDITABLE_RE, (_m, noun: string, mid: string) => {
    count++;
    return `${noun}${mid}replaceable`;
  });
  return { text: t, count };
}

export function findEditableTextClaims(s: string): string[] {
  return [
    ...Array.from(s.matchAll(EDITABLE_TEXT_RE), (m) => m[0]),
    ...Array.from(s.matchAll(TEXT_IS_EDITABLE_RE), (m) => m[0]),
  ];
}

/* ---------- File-type decision (rule D / K) ---------- */
export function stripVectorWords(s: string): string {
  const t = s
    .replace(/\s*\b(?:in\s+)?(?:vector|eps|svg)\s+format\b/gi, "")
    .replace(/\bvector\s+(illustrations?|graphics?|art|artwork|designs?|templates?|backgrounds?)\b/gi, "$1")
    .replace(/\b(?:vectors?|eps|svg)\b\s*/gi, "");
  return tidy(t);
}

export function stripVectorKeywords(list: string[]): string[] {
  const out: string[] = [];
  for (const k of list) {
    if (/^(vectors?|eps|svg|ai|vector file|eps file|ai file|svg file)$/.test(k)) continue;
    const t = k.replace(/\bvectors?\b/g, "").replace(/\s+/g, " ").trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export function applyFileTypeDecision(
  result: MetadataResult,
  decision: FileTypeDecision,
): { result: MetadataResult; changes: string[] } {
  const r: MetadataResult = structuredClone(result);
  const changes: string[] = [];
  const P = r.platforms;
  if (decision === "raster") {
    let textChanged = 0;
    let kwChanged = 0;
    const fixT = (s: string) => {
      const t = stripVectorWords(s);
      if (t !== s) textChanged++;
      return t;
    };
    const fixK = (k: string[]) => {
      const t = stripVectorKeywords(k);
      if (t.length !== k.length || t.some((x, i) => x !== k[i])) kwChanged++;
      return t;
    };
    r.description = fixT(r.description);
    if (P.adobe) {
      P.adobe.title = fixT(P.adobe.title);
      P.adobe.keywords = fixK(P.adobe.keywords);
    }
    if (P.shutterstock) {
      P.shutterstock.description = fixT(P.shutterstock.description);
      P.shutterstock.keywords = fixK(P.shutterstock.keywords);
    }
    if (P.freepik) {
      P.freepik.title = fixT(P.freepik.title);
      P.freepik.keywords = fixK(P.freepik.keywords);
    }
    if (P.istock) {
      P.istock.title = fixT(P.istock.title);
      P.istock.description = fixT(P.istock.description);
      P.istock.keywords = fixK(P.istock.keywords);
    }
    if (textChanged || kwChanged)
      changes.push(
        `Confirmed raster file: removed vector wording from ${textChanged} text field(s) and ${kwChanged} keyword list(s) (rule D)`,
      );
  } else if (P.shutterstock && !P.shutterstock.illustration) {
    P.shutterstock.illustration = true;
    changes.push('Confirmed vector file: Shutterstock "Illustration" set to Yes');
  }
  return { result: r, changes };
}

/* ================================================================== */
/* Keyword helpers                                                     */
/* ================================================================== */
export function normalizeKeyword(k: string): string {
  return k
    .toLowerCase()
    .replace(/[#"“”‘’`*_~^']/g, "")
    .replace(/[.,;:!?()[\]{}<>|\\/+=]+/g, " ")
    .replace(/\s*&\s*/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

function toStringList(v: unknown): string[] {
  if (Array.isArray(v))
    return v.flatMap((x) => (typeof x === "string" ? [x] : typeof x === "number" ? [String(x)] : []));
  if (typeof v === "string") return v.split(/[,;\n]/);
  return [];
}

function stemWord(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith("sses")) return w.slice(0, -2);
  if (w.endsWith("ss") || w.endsWith("us") || w.endsWith("is")) return w;
  if (w.endsWith("s")) return w.slice(0, -1);
  return w;
}
const stemPhrase = (k: string) => k.split(" ").map(stemWord).join(" ");

/* ================================================================== */
/* Validation                                                          */
/* ================================================================== */
export interface ValidationContext {
  hint: ContentTypeHint;
  platforms: PlatformId[];
  fileType: FileTypeDecision | null;
  width?: number;
  height?: number;
}
export interface ValidationOptions {
  /** Final pass: a hint mismatch is downgraded to a warning (content_type is forced to the hint). */
  final?: boolean;
  /** true for model output, false for user edits. */
  autofix?: boolean;
}
export interface ValidationOutput {
  result: MetadataResult | null;
  issues: Issue[];
  errorCount: number;
  /** What the model itself classified the image as (before any hint override). */
  modelContentType: ContentType | null;
}

interface Ctx {
  autofix: boolean;
  ct: ContentType;
  push: (level: IssueLevel, rule: string, message: string, platform?: PlatformId, field?: string) => void;
}

function normalizeContentType(v: unknown): ContentType | null {
  const s = asString(v).toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (["single_asset", "single", "single_background", "single_image", "background"].includes(s)) return "single_asset";
  if (["template_pack", "template", "templates", "design_pack", "template_design_pack", "template_or_design_pack"].includes(s))
    return "template_pack";
  return null;
}

function normalizeFlagCode(code: string, message: string): FlagCode {
  const c = code.toUpperCase().trim().replace(/[^A-Z]+/g, "_").replace(/^_|_$/g, "");
  if ((FLAG_CODES as readonly string[]).includes(c)) return c as FlagCode;
  const t = `${code} ${message}`.toLowerCase();
  if (/vector|\beps\b|\bai file\b|illustrator/.test(t)) return "POSSIBLE_VECTOR";
  if (/hint|mismatch/.test(t)) return "HINT_MISMATCH";
  if (/confiden|unsure|ambiguous|close call/.test(t)) return "LOW_CONFIDENCE_TYPE";
  if (/trademark|logo|brand/.test(t)) return "TRADEMARK_RISK";
  if (/people|person|face|property|release/.test(t)) return "PEOPLE_OR_PROPERTY";
  if (/text|typograph|font|lettering|headline/.test(t)) return "CONTAINS_TEXT";
  if (/quality|noise|blur|artifact|watermark|crop/.test(t)) return "QUALITY_CONCERN";
  return "OTHER";
}

function normalizeFlags(v: unknown): Flag[] {
  const list = Array.isArray(v) ? v : v ? [v] : [];
  const out: Flag[] = [];
  for (const item of list) {
    let code = "";
    let message = "";
    if (typeof item === "string") {
      const m = item.match(/^\s*([A-Za-z_ ]{3,40}?)\s*[:\-–]\s*(.*)$/);
      if (m) {
        code = m[1];
        message = m[2];
      } else {
        code = item;
        message = item;
      }
    } else if (isObj(item)) {
      code = asString(item.code ?? item.type ?? item.flag ?? item.name);
      message = asString(item.message ?? item.detail ?? item.reason ?? item.description ?? item.note);
    } else continue;
    const c = normalizeFlagCode(code, message);
    const msg = cleanText(message === code ? "" : message);
    if (!out.some((f) => f.code === c)) out.push({ code: c, message: msg });
    else if (msg) {
      const existing = out.find((f) => f.code === c);
      if (existing && !existing.message) existing.message = msg;
    }
  }
  return out;
}

function checkText(
  v: unknown,
  p: PlatformId | undefined,
  field: string,
  label: string,
  max: number,
  kind: "title" | "description",
  c: Ctx,
): string {
  let t = kind === "title" ? cleanTitle(asString(v)) : cleanText(asString(v));
  if (!t) {
    c.push("error", "SCHEMA", `${label} is empty`, p, field);
    return "";
  }
  const lvl: IssueLevel = c.autofix ? "fixed" : "warning";
  const limitRule = c.ct === "template_pack" ? "H" : "G";
  const f = removeTerms(t, FILLER_TITLE_TERMS);
  if (f.removed.length) {
    c.push(lvl, "C", `${c.autofix ? "Removed" : "Contains"} filler in ${label}: ${f.removed.join(", ")}`, p, field);
    if (c.autofix) t = f.text;
  }
  const ip = removeTerms(t, IP_TITLE_TERMS);
  if (ip.removed.length) {
    c.push(lvl, "F", `${c.autofix ? "Removed" : "Contains"} AI-tool/software wording in ${label}: ${ip.removed.join(", ")}`, p, field);
    if (c.autofix) t = ip.text;
  }
  if (t.length > max) {
    if (c.autofix) {
      const s = smartShorten(t, max);
      c.push("fixed", limitRule, `${label} was ${t.length} characters — shortened to ${s.length} (ceiling ${max})`, p, field);
      t = s;
    } else c.push("warning", limitRule, `${label} is ${t.length} characters — the ceiling is ${max}`, p, field);
  }
  if (kind === "title") {
    if (t.length < 15) c.push("warning", limitRule, `${label} is very short (${t.length} characters)`, p, field);
    const rep = repeatedWords(t);
    if (rep.length) c.push("warning", "C", `Repeated word(s) in ${label}: ${rep.join(", ")}`, p, field);
  }
  return t;
}

function checkKeywords(v: unknown, p: PlatformId, c: Ctx): string[] {
  const spec = PLATFORM_SPECS[p];
  const input = toStringList(v);
  if (!input.length) {
    c.push("error", "SCHEMA", `${spec.label} keywords are missing`, p, "keywords");
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const stems = new Set<string>();
  const filler: string[] = [];
  const ip: string[] = [];
  const long: string[] = [];
  const exactDupes: string[] = [];
  const pluralDupes: string[] = [];
  for (const item of input) {
    let k = normalizeKeyword(item);
    if (!k) continue;
    if (FILLER_KW_SET.has(k)) {
      filler.push(k);
      if (c.autofix) continue;
    } else {
      const words = k.split(" ");
      const kept = words.filter((w) => !FILLER_PHRASE_SET.has(w));
      if (kept.length !== words.length && kept.length) {
        filler.push(k);
        if (c.autofix) k = kept.join(" ");
      }
    }
    if (IP_SET.has(k)) {
      ip.push(k);
      if (c.autofix) continue;
    }
    if (k.split(" ").length > 4 || k.length > 40) {
      long.push(k);
      if (c.autofix) continue;
    }
    if (seen.has(k)) {
      exactDupes.push(k);
      continue;
    }
    const stem = stemPhrase(k);
    if (stems.has(stem)) {
      pluralDupes.push(k);
      if (c.autofix) continue;
    }
    seen.add(k);
    stems.add(stem);
    out.push(k);
  }
  const lvl: IssueLevel = c.autofix ? "fixed" : "warning";
  if (filler.length)
    c.push(lvl, "C", `${c.autofix ? "Removed" : "Contains"} filler keyword(s): ${uniq(filler).join(", ")}`, p, "keywords");
  if (ip.length)
    c.push(lvl, "F", `${c.autofix ? "Removed" : "Contains"} brand/AI-tool keyword(s): ${uniq(ip).join(", ")}`, p, "keywords");
  if (long.length)
    c.push(lvl, "E", `${c.autofix ? "Removed" : "Contains"} over-long keyword phrase(s): ${uniq(long).join(" · ")}`, p, "keywords");
  if (exactDupes.length) c.push("fixed", "C", `Removed duplicate keyword(s): ${uniq(exactDupes).join(", ")}`, p, "keywords");
  if (pluralDupes.length)
    c.push(lvl, "C", `${c.autofix ? "Removed" : "Contains"} singular/plural duplicate(s): ${uniq(pluralDupes).join(", ")}`, p, "keywords");
  if (out.length > spec.keywordsMax) {
    const extra = out.length - spec.keywordsMax;
    if (c.autofix) {
      out.length = spec.keywordsMax;
      c.push("fixed", "E", `Trimmed ${extra} keyword(s) beyond the ${spec.label} maximum of ${spec.keywordsMax}`, p, "keywords");
    } else c.push("error", "E", `${out.length} keywords — ${spec.label} accepts at most ${spec.keywordsMax}`, p, "keywords");
  }
  if (out.length < spec.keywordsMin)
    c.push("error", "E", `Only ${out.length} keyword(s) — ${spec.label} needs at least ${spec.keywordsMin}`, p, "keywords");
  else if (out.length < spec.keywordsTarget)
    c.push("warning", "E", `${out.length} keywords — aim for ${spec.keywordsTarget}–${spec.keywordsMax} on ${spec.label}`, p, "keywords");
  return out;
}

function checkAdobeCategory(v: unknown, c: Ctx): number {
  let n = typeof v === "number" ? Math.round(v) : parseInt(asString(v), 10);
  if (!Number.isFinite(n) || !ADOBE_CATEGORIES[n]) {
    const name = asString(v).toLowerCase();
    const found = Object.entries(ADOBE_CATEGORIES).find(
      ([, label]) => name && (label.toLowerCase() === name || name.includes(label.toLowerCase())),
    );
    n = found ? Number(found[0]) : NaN;
  }
  if (c.ct === "template_pack" && n !== 8) {
    if (c.autofix) {
      c.push("fixed", "K", `Adobe category ${Number.isFinite(n) ? `${n} (${ADOBE_CATEGORIES[n]})` : `"${asString(v) || "—"}"`} → 8 Graphic Resources`, "adobe", "category");
      return 8;
    }
    c.push("warning", "K", "Template packs belong in Adobe category 8 · Graphic Resources", "adobe", "category");
  }
  if (!Number.isFinite(n) || !ADOBE_CATEGORIES[n]) {
    c.push(c.autofix ? "fixed" : "error", "SCHEMA", "Invalid Adobe category — defaulted to 8 (Graphic Resources)", "adobe", "category");
    return 8;
  }
  return n;
}

const SS_NORMALIZED = SHUTTERSTOCK_CATEGORIES.map((name) => ({
  name: name as string,
  key: name.toLowerCase().replace(/\s*\/\s*/g, "/").replace(/&/g, "and"),
}));
function matchSsCategory(raw: string): string | null {
  const k = raw.toLowerCase().trim().replace(/\s*\/\s*/g, "/").replace(/&/g, "and");
  if (!k) return null;
  const exact = SS_NORMALIZED.find((c) => c.key === k);
  if (exact) return exact.name;
  const partial = SS_NORMALIZED.find((c) => c.key.split("/").some((part) => part === k || part === `${k}s` || `${part}s` === k));
  return partial ? partial.name : null;
}

function checkSsCategories(v: unknown, c: Ctx): string[] {
  const out: string[] = [];
  for (const item of toStringList(v)) {
    const m = matchSsCategory(item);
    if (!m) {
      c.push(c.autofix ? "fixed" : "warning", "SCHEMA", `Dropped unknown Shutterstock category "${item.trim()}"`, "shutterstock", "categories");
      continue;
    }
    if (!out.includes(m)) out.push(m);
  }
  if (c.ct === "template_pack") {
    if (out.includes("Backgrounds/Textures")) {
      if (c.autofix) {
        out.splice(out.indexOf("Backgrounds/Textures"), 1);
        c.push("fixed", "K", 'Removed "Backgrounds/Textures" — template packs use the Graphic Resources equivalent ("Abstract")', "shutterstock", "categories");
      } else c.push("warning", "K", 'Template packs should not use "Backgrounds/Textures"', "shutterstock", "categories");
    }
    if (c.autofix && !out.includes("Abstract")) {
      out.unshift("Abstract");
      c.push("fixed", "K", 'Added "Abstract" — Shutterstock\'s closest equivalent to Graphic Resources', "shutterstock", "categories");
    }
  }
  if (!out.length) {
    const fallback = c.ct === "template_pack" ? "Abstract" : "Backgrounds/Textures";
    out.push(fallback);
    c.push("warning", "SCHEMA", `No valid Shutterstock category — defaulted to "${fallback}"`, "shutterstock", "categories");
  }
  if (out.length > 2) {
    if (c.autofix) {
      c.push("fixed", "SCHEMA", `Shutterstock accepts 2 categories — dropped ${out.slice(2).join(", ")}`, "shutterstock", "categories");
      out.length = 2;
    } else c.push("error", "SCHEMA", "Shutterstock accepts at most 2 categories", "shutterstock", "categories");
  }
  return out;
}

function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = asString(v).toLowerCase().trim();
  return s === "true" || s === "yes" || s === "1";
}

type TextRef = { p: PlatformId; field: string; get: () => string; set: (s: string) => void; isTitle: boolean };
function textRefs(r: MetadataResult): TextRef[] {
  const P = r.platforms;
  const refs: TextRef[] = [];
  if (P.adobe) {
    const a = P.adobe;
    refs.push({ p: "adobe", field: "title", get: () => a.title, set: (s) => (a.title = s), isTitle: true });
  }
  if (P.shutterstock) {
    const s0 = P.shutterstock;
    refs.push({ p: "shutterstock", field: "description", get: () => s0.description, set: (s) => (s0.description = s), isTitle: true });
  }
  if (P.freepik) {
    const f = P.freepik;
    refs.push({ p: "freepik", field: "title", get: () => f.title, set: (s) => (f.title = s), isTitle: true });
  }
  if (P.istock) {
    const i = P.istock;
    refs.push({ p: "istock", field: "title", get: () => i.title, set: (s) => (i.title = s), isTitle: true });
    refs.push({ p: "istock", field: "description", get: () => i.description, set: (s) => (i.description = s), isTitle: false });
  }
  return refs;
}

type KwRef = { p: PlatformId; get: () => string[]; set: (k: string[]) => void };
function keywordRefs(r: MetadataResult): KwRef[] {
  const P = r.platforms;
  const refs: KwRef[] = [];
  const add = (p: PlatformId, m: { keywords: string[] } | undefined) => {
    if (m) refs.push({ p, get: () => m.keywords, set: (k) => (m.keywords = k) });
  };
  add("adobe", P.adobe);
  add("shutterstock", P.shutterstock);
  add("freepik", P.freepik);
  add("istock", P.istock);
  return refs;
}

const label = (p: PlatformId) => PLATFORM_SPECS[p].short;

export function validateResult(raw: unknown, ctx: ValidationContext, opts: ValidationOptions = {}): ValidationOutput {
  const autofix = opts.autofix ?? true;
  const issues: Issue[] = [];
  const push: Ctx["push"] = (level, rule, message, platform, field) => {
    const issue: Issue = { level, rule, message };
    if (platform) issue.platform = platform;
    if (field) issue.field = field;
    issues.push(issue);
  };
  const finish = (result: MetadataResult | null, modelCt: ContentType | null): ValidationOutput => ({
    result,
    issues,
    errorCount: issues.filter((i) => i.level === "error").length,
    modelContentType: modelCt,
  });

  if (!isObj(raw)) {
    push("error", "SCHEMA", "Model output is not a JSON object");
    return finish(null, null);
  }

  /* ---- content type ---- */
  const modelCt = normalizeContentType(raw.content_type);
  let ct: ContentType;
  if (!modelCt) {
    if (ctx.hint !== "auto") {
      ct = ctx.hint;
      push("fixed", "TYPE", `content_type missing or invalid — set to your hint (${CONTENT_TYPE_LABEL[ct]})`);
    } else {
      ct = "single_asset";
      push("error", "TYPE", 'content_type is missing or not one of "single_asset" | "template_pack"');
    }
  } else ct = modelCt;

  const flags = normalizeFlags(raw.flags);
  if (ctx.hint !== "auto" && modelCt && modelCt !== ctx.hint) {
    push(
      opts.final ? "warning" : "error",
      "TYPE",
      `The model classified this as ${CONTENT_TYPE_LABEL[modelCt]}, but your hint is ${CONTENT_TYPE_LABEL[ctx.hint]} — ${opts.final ? "hint applied; review the wording" : "the output must follow the hint's rule set"}`,
    );
    ct = ctx.hint;
    if (!flags.some((f) => f.code === "HINT_MISMATCH"))
      flags.push({ code: "HINT_MISMATCH", message: `The model's own reading was ${CONTENT_TYPE_LABEL[modelCt]}.` });
  }
  const c: Ctx = { autofix, ct, push };

  /* ---- top-level description ---- */
  let description = checkTextLoose(raw.description);
  if (!description) push("warning", "SCHEMA", "Top-level description is missing");
  else if (description.length > 200) {
    if (autofix) {
      description = smartShorten(description, 200);
      push("fixed", "G", "Top-level description shortened to 200 characters");
    } else push("warning", "G", "Top-level description exceeds 200 characters");
  }

  /* ---- platforms (strict: only requested platforms, only known fields) ---- */
  const rawPlatforms = isObj(raw.platforms) ? raw.platforms : null;
  if (!rawPlatforms) push("error", "SCHEMA", '"platforms" object is missing');
  const platforms: PlatformsMeta = {};
  for (const p of ctx.platforms) {
    const rp = rawPlatforms?.[p];
    if (!isObj(rp)) {
      push("error", "SCHEMA", `Missing metadata for ${PLATFORM_SPECS[p].label}`, p);
      continue;
    }
    if (p === "adobe") {
      const m: AdobeMeta = {
        title: checkText(rp.title, p, "title", "Adobe title", PLATFORM_SPECS.adobe.titleMax, "title", c),
        keywords: checkKeywords(rp.keywords, p, c),
        category: checkAdobeCategory(rp.category, c),
      };
      platforms.adobe = m;
    } else if (p === "shutterstock") {
      const m: ShutterstockMeta = {
        description: checkText(rp.description ?? rp.title, p, "description", "Shutterstock description", PLATFORM_SPECS.shutterstock.titleMax, "description", c),
        keywords: checkKeywords(rp.keywords, p, c),
        categories: checkSsCategories(rp.categories ?? rp.category, c),
        illustration: toBool(rp.illustration),
      };
      platforms.shutterstock = m;
    } else if (p === "freepik") {
      const m: FreepikMeta = {
        title: checkText(rp.title, p, "title", "Freepik title", PLATFORM_SPECS.freepik.titleMax, "title", c),
        keywords: checkKeywords(rp.keywords, p, c),
      };
      platforms.freepik = m;
    } else {
      let desc = rp.description;
      if (!asString(desc).trim() && description) {
        desc = description;
        push(autofix ? "fixed" : "warning", "SCHEMA", "iStock description was empty — used the top-level description", p, "description");
      }
      const m: IStockMeta = {
        title: checkText(rp.title, p, "title", "iStock title", PLATFORM_SPECS.istock.titleMax, "title", c),
        description: checkText(desc, p, "description", "iStock description", PLATFORM_SPECS.istock.descriptionMax ?? 200, "description", c),
        keywords: checkKeywords(rp.keywords, p, c),
      };
      platforms.istock = m;
    }
  }

  /* ---- category suggestion (rule K for template packs) ---- */
  let category = cleanText(asString(raw.category_suggestion));
  if (ct === "template_pack") {
    if (!/^graphic resources$/i.test(category)) {
      if (autofix) {
        push("fixed", "K", `category_suggestion "${category || "—"}" → "Graphic Resources" (template packs are Graphic Resources, not Backgrounds/Textures)`);
        category = "Graphic Resources";
      } else push("warning", "K", 'Template packs should use category "Graphic Resources"');
    } else category = "Graphic Resources";
  } else if (!category) {
    category = platforms.shutterstock?.categories[0] ?? "Backgrounds/Textures";
    push("warning", "SCHEMA", `category_suggestion missing — using "${category}"`);
  }

  const result: MetadataResult = { content_type: ct, description, platforms, category_suggestion: category, flags };
  const texts = textRefs(result);
  const kws = keywordRefs(result);

  /* ---- Rule J (template_pack only): "editable text" → "replaceable text" ---- */
  if (ct === "template_pack") {
    let swaps = 0;
    const found: string[] = [];
    for (const t of texts) {
      if (autofix) {
        const s = swapEditableText(t.get());
        if (s.count) {
          swaps += s.count;
          t.set(s.text);
        }
      } else found.push(...findEditableTextClaims(t.get()));
    }
    if (autofix) {
      const d = swapEditableText(result.description);
      if (d.count) {
        swaps += d.count;
        result.description = d.text;
      }
    }
    for (const k of kws) {
      if (autofix) {
        let changed = false;
        const next = uniq(
          k.get().map((kw) => {
            const s = swapEditableText(kw);
            if (s.count) {
              swaps += s.count;
              changed = true;
            }
            return s.text.toLowerCase();
          }),
        );
        if (changed) k.set(next);
      } else found.push(...k.get().flatMap((kw) => findEditableTextClaims(kw)));
    }
    if (swaps) push("fixed", "J", `Replaced ${swaps} "editable text"-style claim(s) with "replaceable text" (Adobe vector guidance)`);
    if (found.length) push("warning", "J", `Use "replaceable" for text, not "editable": ${uniq(found).join(", ")}`);

    if (flags.some((f) => f.code === "CONTAINS_TEXT")) {
      const missing = kws.filter((k) => !k.get().includes("replaceable text"));
      if (missing.length) {
        if (autofix) {
          for (const k of missing) {
            const list = [...k.get()];
            const max = PLATFORM_SPECS[k.p].keywordsMax;
            if (list.length >= max) list.length = max - 1;
            list.splice(Math.min(10, list.length), 0, "replaceable text");
            k.set(list);
          }
          push("fixed", "J", `Text is present — added keyword "replaceable text" on ${missing.map((k) => label(k.p)).join(", ")}`);
        } else push("warning", "J", `Text is present — add keyword "replaceable text" on ${missing.map((k) => label(k.p)).join(", ")}`);
      }
    }
  }

  /* ---- Rule D: orientation contradictions (single_asset — packs often hold vertical posters in a landscape preview) ---- */
  if (ct === "single_asset" && ctx.width && ctx.height) {
    const bad = ctx.width > ctx.height * 1.05 ? "horizontal-bad" : ctx.height > ctx.width * 1.05 ? "vertical-bad" : null;
    const word = bad === "horizontal-bad" ? "vertical" : bad === "vertical-bad" ? "horizontal" : null;
    if (word) {
      const hit = kws.filter((k) => k.get().some((kw) => kw === word || kw === `${word} format` || kw === `${word} orientation`));
      if (hit.length) {
        if (autofix) {
          for (const k of hit) k.set(k.get().filter((kw) => kw !== word && kw !== `${word} format` && kw !== `${word} orientation`));
          push("fixed", "D", `Removed "${word}" — contradicts the image orientation`);
        } else push("warning", "D", `"${word}" contradicts the image orientation`);
      }
    }
  }

  /* ---- Rule D / K: confirmed file type ---- */
  if (ctx.fileType === "raster") {
    const vectorish = texts.some((t) => /\bvectors?\b/i.test(t.get())) || kws.some((k) => k.get().some((kw) => /\bvectors?\b|^eps$|^svg$/.test(kw)));
    if (vectorish) {
      if (autofix) {
        const t = applyFileTypeDecision(result, "raster");
        Object.assign(result, t.result);
        for (const ch of t.changes) push("fixed", "D", ch);
      } else push("warning", "D", 'File is confirmed raster, but "vector" wording is still present');
    }
  } else if (ctx.fileType === "vector" && result.platforms.shutterstock && !result.platforms.shutterstock.illustration) {
    if (autofix) {
      result.platforms.shutterstock.illustration = true;
      push("fixed", "K", 'Confirmed vector file — Shutterstock "Illustration" set to Yes', "shutterstock", "illustration");
    } else push("warning", "K", 'Confirmed vector files should be marked as Illustration on Shutterstock', "shutterstock", "illustration");
  }

  /* ---- Rule A: colors (both types) ---- */
  const kwsNow = keywordRefs(result);
  const textsNow = textRefs(result);
  const noColorKw = kwsNow.filter((k) => k.get().length && !k.get().some((kw) => hasColorWord(kw)));
  if (noColorKw.length) push("warning", "A", `No color keyword on ${noColorKw.map((k) => label(k.p)).join(", ")}`);
  const noColorTitle = textsNow.filter((t) => t.isTitle && t.get() && !hasColorWord(t.get()));
  if (noColorTitle.length) push("warning", "A", `Main color not named in the ${noColorTitle.map((t) => `${label(t.p)} ${t.field}`).join(", ")}`);

  /* ---- Rule B: use-case keywords (both types) ---- */
  const lowUse = kwsNow.filter(
    (k) => k.get().length && k.get().filter((kw) => USE_CASE_SET.has(kw) || kw.split(" ").some((w) => USE_CASE_SET.has(w))).length < 3,
  );
  if (lowUse.length) push("warning", "B", `Fewer than 3 use-case keywords on ${lowUse.map((k) => label(k.p)).join(", ")}`);

  if (ct === "single_asset") {
    /* ---- Rule G: literal, single-visual title ---- */
    const collection = textsNow.filter((t) => t.isTitle && COLLECTION_WORDING_RE.test(t.get()));
    if (collection.length)
      push("warning", "G", `Collection wording in a single-asset title (${collection.map((t) => label(t.p)).join(", ")}) — describe the one visual, or switch the hint to Template / design pack`);
  } else {
    /* ---- Rule H: collection-style title ---- */
    const noKind = textsNow.filter((t) => t.isTitle && t.get() && !hasTemplateKindNoun(t.get()));
    if (noKind.length) push("warning", "H", `Title doesn't say what kind of templates the set holds (${noKind.map((t) => label(t.p)).join(", ")})`);
    const main = result.platforms.adobe?.title || result.platforms.freepik?.title || result.platforms.istock?.title || "";
    if (main) {
      const n = countListedElements(main);
      if (n < 2) push("warning", "H", `Title lists ${n} distinct element(s) — rule H asks for 2–4 of the set's most distinct elements`);
      else if (n > 4) push("warning", "H", `Title lists ${n} elements — keep the 2–4 most commercially distinctive`);
    }
    /* ---- Rule I: design-purpose keywords alongside colors & use-cases ---- */
    const lowDesign = kwsNow.filter((k) => k.get().length && designPurposeCount(k.get()) < 3);
    if (lowDesign.length) push("warning", "I", `Fewer than 3 design-purpose keywords (template, poster, layout, cover…) on ${lowDesign.map((k) => label(k.p)).join(", ")}`);
  }

  return finish(result, modelCt);
}

function checkTextLoose(v: unknown): string {
  return cleanText(asString(v));
}
