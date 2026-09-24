import {
  PROVIDERS,
  WIRE_FORMATS,
  buildExtraBody,
  getProviderDef,
  type ProviderDef,
  type ProviderOptions,
  type ProviderStateDTO,
  type WireFormat,
} from "@/lib/providers/registry";
import { getProviderRow, getProviderRows, type ProviderRow } from "./repo";
import { ProviderError } from "./errors";

export interface ResolvedProviderConfig {
  id: string;
  label: string;
  def: ProviderDef;
  apiKey: string;
  baseUrl: string;
  model: string;
  wireFormat: WireFormat;
  jsonMode: boolean;
  options: ProviderOptions;
  extraBody: Record<string, unknown>;
  extraHeaders: Record<string, string>;
  timeoutMs: number;
}

export const isWireFormat = (v: unknown): v is WireFormat => WIRE_FORMATS.some((w) => w.id === v);
const env = (name: string) => process.env[name]?.trim() || "";
const mask = (k: string) => (k.length <= 8 ? "••••" : `${k.slice(0, 3)}••••${k.slice(-4)}`);

function effective(def: ProviderDef, row: ProviderRow | null | undefined) {
  const savedKey = row?.apiKey?.trim() || "";
  const envKey = env(def.envKey);
  const apiKey = savedKey || envKey;
  const baseUrl = (row?.baseUrl?.trim() || env(def.envBaseUrl) || def.baseUrl || "").replace(/\/+$/, "");
  const model = row?.model?.trim() || env(def.envModel) || def.defaultModel;
  const wf = row?.wireFormat;
  const wireFormat: WireFormat = def.wireFormatEditable && isWireFormat(wf) ? wf : def.wireFormat;
  const options = (row?.options ?? {}) as ProviderOptions;
  const enabled = row?.enabled ?? true;
  const keySource: "saved" | "env" | null = savedKey ? "saved" : envKey ? "env" : null;
  return { apiKey, keySource, baseUrl, model, wireFormat, options, enabled };
}

function readiness(e: ReturnType<typeof effective>): string | null {
  if (!e.enabled) return "Disabled";
  if (!e.apiKey) return "API key missing";
  if (!e.baseUrl) return "Base URL missing";
  if (!e.model) return "Model ID missing";
  return null;
}

export function toProviderState(def: ProviderDef, row: ProviderRow | null | undefined): ProviderStateDTO {
  const e = effective(def, row);
  const reason = readiness(e);
  const wf = row?.wireFormat;
  return {
    id: def.id,
    label: def.label,
    kind: def.kind,
    isDefault: !!def.isDefault,
    notes: def.notes,
    pricing: def.pricing ?? null,
    docsUrl: def.docsUrl ?? null,
    keyUrl: def.keyUrl ?? null,
    envKey: def.envKey,
    defaultBaseUrl: def.baseUrl,
    defaultModel: def.defaultModel,
    suggestedModels: def.suggestedModels,
    legacyModels: def.legacyModels ?? {},
    wireFormatEditable: def.wireFormatEditable,
    supportsThinkingToggle: !!def.supportsThinkingToggle,
    baseUrl: e.baseUrl,
    model: e.model,
    wireFormat: e.wireFormat,
    enabled: e.enabled,
    options: e.options,
    baseUrlOverride: row?.baseUrl?.trim() || null,
    modelOverride: row?.model?.trim() || null,
    wireFormatOverride: def.wireFormatEditable && isWireFormat(wf) ? wf : null,
    hasKey: !!e.apiKey,
    keySource: e.keySource,
    keyPreview: e.apiKey ? mask(e.apiKey) : null,
    ready: reason === null,
    readyReason: reason,
  };
}

export async function listProviderStates(): Promise<ProviderStateDTO[]> {
  const rows = await getProviderRows();
  const byId = new Map(rows.map((r) => [r.id, r]));
  return PROVIDERS.map((def) => toProviderState(def, byId.get(def.id)));
}

export async function getProviderState(id: string): Promise<ProviderStateDTO | null> {
  const def = getProviderDef(id);
  if (!def) return null;
  return toProviderState(def, await getProviderRow(id));
}

export async function resolveProviderConfig(id: string): Promise<ResolvedProviderConfig> {
  const def = getProviderDef(id);
  if (!def) throw new ProviderError("config", `Unknown provider "${id}"`);
  const e = effective(def, await getProviderRow(id));
  const reason = readiness(e);
  if (reason) {
    const hint =
      reason === "API key missing"
        ? ` Add it in Settings → Providers (or set ${def.envKey}).`
        : reason === "Disabled"
          ? " Enable it in Settings → Providers."
          : " Set it in Settings → Providers.";
    throw new ProviderError("config", `${def.label}: ${reason}.${hint}`);
  }
  return {
    id: def.id,
    label: def.label,
    def,
    apiKey: e.apiKey,
    baseUrl: e.baseUrl,
    model: e.model.replace(/^models\//, ""),
    wireFormat: e.wireFormat,
    jsonMode: def.jsonMode,
    options: e.options,
    extraBody: buildExtraBody(def, e.options),
    extraHeaders: def.extraHeaders ?? {},
    timeoutMs: 120_000,
  };
}
