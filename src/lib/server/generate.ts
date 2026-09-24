import { PROMPT_VERSION, SYSTEM_PROMPT, buildRepairMessage, buildUserMessage } from "@/lib/prompt";
import { applyFileTypeDecision, extractJson, validateResult, type ValidationContext, type ValidationOutput } from "@/lib/validation";
import type { ContentTypeHint, FileTypeDecision, Issue, MetadataResult, PlatformId, UsageInfo } from "@/lib/types";
import { callWithRetry, type CallResponse, type ChatTurn } from "./adapters";
import { resolveProviderConfig } from "./providers";

export interface GenerateInput {
  providerId: string;
  image: { base64: string; mime: string };
  filename: string;
  width: number;
  height: number;
  hint: ContentTypeHint;
  platforms: PlatformId[];
  fileType: FileTypeDecision | null;
  vectorCompanion: string | null;
}

export interface GenerateOutput {
  result: MetadataResult | null;
  issues: Issue[];
  /** Parsed raw model JSON (before the validation layer) — kept for audit & acceptance checks. */
  raw: unknown;
  rawText: string;
  model: string;
  providerId: string;
  modelContentType: string | null;
  usage: UsageInfo;
}

function parse(text: string, ctx: ValidationContext, final: boolean): { raw: unknown; v: ValidationOutput } {
  try {
    const raw = extractJson(text);
    return { raw, v: validateResult(raw, ctx, { final, autofix: true }) };
  } catch (e) {
    return {
      raw: null,
      v: {
        result: null,
        issues: [{ level: "error", rule: "JSON", message: e instanceof Error ? e.message : String(e) }],
        errorCount: 1,
        modelContentType: null,
      },
    };
  }
}

/**
 * One image → classified, rule-checked platform metadata.
 * 1. single vision call (system prompt is static → prefix-cache friendly)
 * 2. strict validation; blocking errors trigger ONE repair turn
 * 3. final validation pass on the better output (hint mismatch → forced + warning)
 */
export async function generateMetadata(input: GenerateInput): Promise<GenerateOutput> {
  const cfg = await resolveProviderConfig(input.providerId);
  const ctx: ValidationContext = {
    hint: input.hint,
    platforms: input.platforms,
    fileType: input.fileType,
    width: input.width,
    height: input.height,
  };
  const t0 = Date.now();
  let attempts = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const call = async (turns: ChatTurn[]): Promise<CallResponse> => {
    attempts++;
    const res = await callWithRetry(cfg, { system: SYSTEM_PROMPT, turns, maxTokens: 4000, temperature: 0.3, json: true });
    inputTokens += res.inputTokens;
    outputTokens += res.outputTokens;
    return res;
  };

  const turns: ChatTurn[] = [{ role: "user", text: buildUserMessage(input), image: input.image }];
  let res = await call(turns);
  let first = parse(res.text, ctx, false);
  let repaired = false;

  if (first.v.errorCount > 0) {
    const errors = first.v.issues.filter((i) => i.level === "error");
    try {
      const res2 = await call([
        ...turns,
        { role: "assistant", text: res.text || "(empty)" },
        { role: "user", text: buildRepairMessage(errors, input.hint) },
      ]);
      const second = parse(res2.text, ctx, false);
      if (!first.v.result || second.v.errorCount <= first.v.errorCount) {
        first = second;
        res = res2;
        repaired = true;
      }
    } catch {
      /* keep the first answer — its issues are reported below */
    }
  }

  // Final pass on the chosen output.
  const final = parse(res.text, ctx, true);
  let result = final.v.result;
  const issues: Issue[] = [...final.v.issues];
  if (repaired)
    issues.unshift({ level: "fixed", rule: "REPAIR", message: "First answer failed strict validation — the model repaired it in a follow-up turn." });
  if (result && input.fileType) {
    const t = applyFileTypeDecision(result, input.fileType);
    result = t.result;
    for (const ch of t.changes) issues.push({ level: "fixed", rule: "K", message: ch });
  }

  return {
    result,
    issues,
    raw: final.raw,
    rawText: res.text,
    model: res.model || cfg.model,
    providerId: cfg.id,
    modelContentType: final.v.modelContentType,
    usage: {
      inputTokens,
      outputTokens,
      attempts,
      latencyMs: Date.now() - t0,
      promptVersion: PROMPT_VERSION,
      modelContentType: final.v.modelContentType,
    },
  };
}
