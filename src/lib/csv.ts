// CSV builders — pure, used by the export dialog (client) and /api/export (server).

import type { AssetDTO, PlatformId } from "./types";
import { errorCount, needsFileTypeConfirmation } from "./types";
import { ADOBE_FILENAME_CAP, ISTOCK_CV_CAVEAT, PLATFORM_SPECS } from "./platforms";

export type QuoteChar = "'" | '"' | "";

export interface ExportOptions {
  /** Adobe: cap filenames at 30 characters in the CSV (warns with the renames). */
  adobeCapFilenames: boolean;
  /** Use the paired vector source name (.eps/.ai) for confirmed vector assets. */
  useVectorSourceName: boolean;
  /** Freepik quote character — single quote by convention. */
  freepikQuote: QuoteChar;
  /** Freepik "Model" column (only for AI-generated content). */
  freepikModel: string;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  adobeCapFilenames: true,
  useVectorSourceName: true,
  freepikQuote: "'",
  freepikModel: "",
};

export interface ExportResult {
  platform: PlatformId;
  filename: string;
  content: string;
  rows: number;
  warnings: string[];
  skipped: { filename: string; reason: string }[];
  renamed: { from: string; to: string }[];
}

export const CSV_FORMATS: Record<PlatformId, { delimiter: string; columns: string[]; note: string }> = {
  adobe: {
    delimiter: ",",
    columns: ["Filename", "Title", "Keywords", "Category", "Releases"],
    note: `Comma-delimited, every value wrapped in "double quotes". Filenames are capped at ${ADOBE_FILENAME_CAP} characters.`,
  },
  shutterstock: {
    delimiter: ",",
    columns: ["Filename", "Description", "Keywords", "Categories", "Illustration", "Mature Content", "Editorial"],
    note: 'Comma-delimited, every value wrapped in "double quotes". 1–2 categories from Shutterstock\'s fixed list.',
  },
  freepik: {
    delimiter: ";",
    columns: ["File name", "Title", "Keywords", "Prompt", "Model"],
    note: "Semicolon-delimited, values wrapped in 'single quotes'; keywords comma-separated inside their field.",
  },
  istock: {
    delimiter: ",",
    columns: ["file name", "created date", "description", "country", "brief code", "title", "keywords"],
    note: `Comma-delimited, every value wrapped in "double quotes". ${ISTOCK_CV_CAVEAT}`,
  },
};

function quote(v: string, q: QuoteChar, delimiter: string): string {
  const clean = v.replace(/\r?\n|\r/g, " ");
  if (!q) return clean.split(delimiter).join(" ");
  return q + clean.split(q).join(q + q) + q;
}

function splitName(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { base: name.slice(0, dot), ext: name.slice(dot) } : { base: name, ext: "" };
}

export function capFilename(name: string, cap = ADOBE_FILENAME_CAP, suffix = ""): string {
  if (name.length <= cap && !suffix) return name;
  const { base, ext } = splitName(name);
  const room = Math.max(1, cap - ext.length - suffix.length);
  return base.slice(0, room).replace(/[\s._-]+$/, "") + suffix + ext;
}

function uniqueCapped(name: string, used: Set<string>): string {
  let c = capFilename(name);
  for (let i = 2; used.has(c.toLowerCase()) && i < 1000; i++) c = capFilename(name, ADOBE_FILENAME_CAP, `_${i}`);
  return c;
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function buildCsv(
  platform: PlatformId,
  assets: AssetDTO[],
  opts: ExportOptions = DEFAULT_EXPORT_OPTIONS,
  now: Date = new Date(),
): ExportResult {
  const fmt = CSV_FORMATS[platform];
  const spec = PLATFORM_SPECS[platform];
  const q: QuoteChar = platform === "freepik" ? opts.freepikQuote : '"';
  const warnings: string[] = [];
  const skipped: ExportResult["skipped"] = [];
  const renamed: ExportResult["renamed"] = [];
  const lines: string[] = [fmt.columns.join(fmt.delimiter)];
  const used = new Set<string>();
  const longNames: string[] = [];
  let unconfirmed = 0;
  let withErrors = 0;
  let overLimit = 0;
  let rows = 0;

  for (const a of assets) {
    const r = a.result;
    if (!r) {
      skipped.push({ filename: a.filename, reason: "No metadata generated yet" });
      continue;
    }
    const P = r.platforms;
    if (!P[platform]) {
      skipped.push({ filename: a.filename, reason: `No ${spec.label} metadata — regenerate with ${spec.short} enabled` });
      continue;
    }
    if (needsFileTypeConfirmation(a)) unconfirmed++;
    if (errorCount(a) > 0) withErrors++;

    let fname = opts.useVectorSourceName && a.fileType === "vector" && a.vectorCompanion ? a.vectorCompanion : a.filename;
    if (platform === "adobe" && fname.length > ADOBE_FILENAME_CAP) {
      if (opts.adobeCapFilenames) {
        const capped = uniqueCapped(fname, used);
        renamed.push({ from: fname, to: capped });
        fname = capped;
      } else longNames.push(fname);
    }
    used.add(fname.toLowerCase());

    let row: string[];
    if (platform === "adobe" && P.adobe) {
      if (P.adobe.title.length > spec.titleMax) overLimit++;
      row = [fname, P.adobe.title, P.adobe.keywords.join(", "), String(P.adobe.category), ""];
    } else if (platform === "shutterstock" && P.shutterstock) {
      const s = P.shutterstock;
      if (s.description.length > spec.titleMax) overLimit++;
      const illustration = a.fileType === "vector" || s.illustration;
      row = [fname, s.description, s.keywords.join(","), s.categories.join(","), illustration ? "Yes" : "No", "No", "No"];
    } else if (platform === "freepik" && P.freepik) {
      if (P.freepik.title.length > spec.titleMax) overLimit++;
      row = [fname, P.freepik.title, P.freepik.keywords.join(","), "", opts.freepikModel.trim()];
    } else if (platform === "istock" && P.istock) {
      const i = P.istock;
      if (i.title.length > spec.titleMax || i.description.length > (spec.descriptionMax ?? 200)) overLimit++;
      row = [fname, "", i.description, "", "", i.title, i.keywords.join(",")];
    } else continue;

    lines.push(row.map((v) => quote(v, q, fmt.delimiter)).join(fmt.delimiter));
    rows++;
  }

  if (renamed.length) {
    const ex = renamed[0];
    warnings.push(
      `${renamed.length} filename(s) exceeded Adobe's ${ADOBE_FILENAME_CAP}-character cap and were shortened in the CSV. Rename the actual files to match before uploading (e.g. ${ex.from} → ${ex.to}).`,
    );
  }
  if (longNames.length)
    warnings.push(
      `${longNames.length} filename(s) exceed Adobe's ${ADOBE_FILENAME_CAP}-character cap — Adobe may fail to match these rows to your uploads.`,
    );
  if (platform === "istock") warnings.push(ISTOCK_CV_CAVEAT);
  if (unconfirmed)
    warnings.push(`${unconfirmed} row(s) are flagged as possible vectors but the actual file type hasn't been confirmed.`);
  if (withErrors) warnings.push(`${withErrors} row(s) still have validation errors — review them before uploading.`);
  if (overLimit) warnings.push(`${overLimit} row(s) have a title/description over the ${spec.label} ceiling.`);
  if (platform === "freepik" && !opts.freepikQuote)
    warnings.push("Quoting is off — semicolons inside values were replaced with spaces.");

  const slug = platform === "adobe" ? "adobe-stock" : platform === "istock" ? "istock-getty" : platform;
  return {
    platform,
    filename: `${slug}-metadata-${stamp(now)}.csv`,
    content: `${lines.join("\n")}\n`,
    rows,
    warnings,
    skipped,
    renamed,
  };
}
