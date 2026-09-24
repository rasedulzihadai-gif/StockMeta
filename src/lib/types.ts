// Shared domain types — safe to import from both server and client code.

export type ContentType = "single_asset" | "template_pack";
export type ContentTypeHint = "auto" | ContentType;
export type PlatformId = "adobe" | "shutterstock" | "freepik" | "istock";

export const PLATFORM_IDS: PlatformId[] = ["adobe", "shutterstock", "freepik", "istock"];
export const CONTENT_TYPES: ContentType[] = ["single_asset", "template_pack"];
export const HINTS: ContentTypeHint[] = ["auto", "single_asset", "template_pack"];

export const CONTENT_TYPE_LABEL: Record<ContentType, string> = {
  single_asset: "Single background",
  template_pack: "Template / design pack",
};

export const HINT_LABEL: Record<ContentTypeHint, string> = {
  auto: "Auto-detect",
  single_asset: "Single background",
  template_pack: "Template / design pack",
};

export interface AdobeMeta {
  title: string;
  keywords: string[];
  category: number;
}
export interface ShutterstockMeta {
  description: string;
  keywords: string[];
  categories: string[];
  illustration: boolean;
}
export interface FreepikMeta {
  title: string;
  keywords: string[];
}
export interface IStockMeta {
  title: string;
  description: string;
  keywords: string[];
}
export interface PlatformsMeta {
  adobe?: AdobeMeta;
  shutterstock?: ShutterstockMeta;
  freepik?: FreepikMeta;
  istock?: IStockMeta;
}

export const FLAG_CODES = [
  "POSSIBLE_VECTOR",
  "CONTAINS_TEXT",
  "HINT_MISMATCH",
  "LOW_CONFIDENCE_TYPE",
  "TRADEMARK_RISK",
  "PEOPLE_OR_PROPERTY",
  "QUALITY_CONCERN",
  "OTHER",
] as const;
export type FlagCode = (typeof FLAG_CODES)[number];

export const FLAG_LABEL: Record<FlagCode, string> = {
  POSSIBLE_VECTOR: "Possible vector (AI/EPS)",
  CONTAINS_TEXT: "Contains text",
  HINT_MISMATCH: "Hint mismatch",
  LOW_CONFIDENCE_TYPE: "Low-confidence type",
  TRADEMARK_RISK: "Trademark risk",
  PEOPLE_OR_PROPERTY: "People / property",
  QUALITY_CONCERN: "Quality concern",
  OTHER: "Note",
};

export interface Flag {
  code: FlagCode;
  message: string;
}

/** The validated output contract (strict — unknown fields are dropped by the validator). */
export interface MetadataResult {
  content_type: ContentType;
  description: string;
  platforms: PlatformsMeta;
  category_suggestion: string;
  flags: Flag[];
}

export type IssueLevel = "error" | "warning" | "fixed";
export interface Issue {
  level: IssueLevel;
  /** Rule letter (A–K) or a structural code such as SCHEMA / TYPE / JSON / REPAIR. */
  rule: string;
  message: string;
  platform?: PlatformId;
  field?: string;
}

export type AssetStatus = "pending" | "processing" | "done" | "error";
export type FileTypeDecision = "vector" | "raster";

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  attempts: number;
  latencyMs: number;
  promptVersion: string;
  modelContentType: string | null;
}

export interface AssetDTO {
  id: string;
  filename: string;
  width: number;
  height: number;
  hint: ContentTypeHint;
  status: AssetStatus;
  error: string | null;
  providerId: string | null;
  model: string | null;
  result: MetadataResult | null;
  issues: Issue[];
  fileType: FileTypeDecision | null;
  vectorCompanion: string | null;
  usage: UsageInfo | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettingsDTO {
  activeProviderId: string;
  platforms: PlatformId[];
  defaultHint: ContentTypeHint;
  concurrency: number;
}

/** Where uploads/keys/API keys are persisted. `ephemeral` = the normal store is not
 *  writable (e.g. a read-only deploy filesystem) and a temp-dir fallback is in use. */
export interface StorageInfoDTO {
  mode: "local" | "postgres";
  dir: string | null;
  ephemeral: boolean;
}

/** Result of a cheap reachability probe to the active provider's base URL.
 *  `reachable: null` means no probe could be made (no provider configured). */
export interface ConnectivityDTO {
  host: string | null;
  reachable: boolean | null;
}

export interface ServerInfoDTO {
  storage: StorageInfoDTO;
  connectivity: ConnectivityDTO;
}

export function isHint(v: unknown): v is ContentTypeHint {
  return v === "auto" || v === "single_asset" || v === "template_pack";
}
export function isContentType(v: unknown): v is ContentType {
  return v === "single_asset" || v === "template_pack";
}
export function isPlatformId(v: unknown): v is PlatformId {
  return typeof v === "string" && (PLATFORM_IDS as string[]).includes(v);
}

export function needsFileTypeConfirmation(a: Pick<AssetDTO, "result" | "fileType">): boolean {
  return !!a.result && !a.fileType && a.result.flags.some((f) => f.code === "POSSIBLE_VECTOR");
}
export function errorCount(a: Pick<AssetDTO, "issues">): number {
  return a.issues.filter((i) => i.level === "error").length;
}
export function needsReview(a: AssetDTO): boolean {
  return (
    a.status === "done" &&
    (errorCount(a) > 0 ||
      needsFileTypeConfirmation(a) ||
      !!a.result?.flags.some((f) => f.code === "HINT_MISMATCH" || f.code === "LOW_CONFIDENCE_TYPE"))
  );
}
