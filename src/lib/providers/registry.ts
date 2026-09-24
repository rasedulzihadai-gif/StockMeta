// Provider registry — client-safe (no secrets). Every provider is an independent
// slot: its own key, base URL, model and (for gateways) wire format.
// DeepSeek is the primary / default-selected provider.

export type WireFormat = "openai-chat-completions" | "anthropic-messages" | "gemini-generate-content";

export const WIRE_FORMATS: { id: WireFormat; label: string }[] = [
  { id: "openai-chat-completions", label: "OpenAI Chat Completions" },
  { id: "anthropic-messages", label: "Anthropic Messages" },
  { id: "gemini-generate-content", label: "Gemini generateContent" },
];

export type AuthSpec = { type: "bearer" } | { type: "header"; header: string };

export interface ProviderOptions {
  /** DeepSeek only: enable thinking mode (slower, more output tokens). Off by default. */
  thinking?: boolean;
}

export interface ProviderDef {
  id: string;
  label: string;
  kind: "direct" | "gateway";
  wireFormat: WireFormat;
  wireFormatEditable: boolean;
  baseUrl: string;
  auth: AuthSpec;
  extraHeaders?: Record<string, string>;
  defaultModel: string;
  suggestedModels: string[];
  /** Old model IDs that still work but should be migrated. value = preferred ID. */
  legacyModels?: Record<string, string>;
  envKey: string;
  envBaseUrl: string;
  envModel: string;
  /** Send response_format: {type: "json_object"} (auto-dropped if the endpoint rejects it). */
  jsonMode: boolean;
  supportsThinkingToggle?: boolean;
  notes: string;
  pricing?: string;
  docsUrl?: string;
  keyUrl?: string;
  isDefault?: boolean;
}

export const DEFAULT_PROVIDER_ID = "deepseek";

const GATEWAY_NOTES =
  "Gateway slot. Enter the gateway's base URL, API key and a vision-capable model ID. Most gateways speak OpenAI Chat Completions; switch the wire format if yours speaks Anthropic Messages or Gemini.";

export const PROVIDERS: ProviderDef[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "direct",
    wireFormat: "openai-chat-completions",
    wireFormatEditable: false,
    baseUrl: "https://api.deepseek.com/v1",
    auth: { type: "bearer" }, // Authorization: Bearer API_KEY
    defaultModel: "deepseek-flash",
    suggestedModels: ["deepseek-flash", "deepseek-v4-flash-vision-exp"],
    legacyModels: {
      "deepseek-v4-flash-vision-exp": "deepseek-flash",
      "deepseek-v4-flash": "deepseek-flash",
    },
    envKey: "DEEPSEEK_API_KEY",
    envBaseUrl: "DEEPSEEK_BASE_URL",
    envModel: "DEEPSEEK_MODEL",
    jsonMode: true,
    supportsThinkingToggle: true,
    notes:
      "Native multimodal — accepts image_url exactly like OpenAI. deepseek-flash (GA Sept 10 2026) has vision built in, no \"-vision-exp\" suffix needed; the old deepseek-v4-flash-vision-exp ID still routes to the same model. Weaker at dense small-text OCR than at scene/composition understanding — irrelevant for background/pattern/template analysis, so no special handling.",
    pricing: "≈ $0.22 / 1M input tokens — cheapest default",
    docsUrl: "https://api-docs.deepseek.com/",
    keyUrl: "https://platform.deepseek.com/api_keys",
    isDefault: true,
  },
  {
    id: "gemini",
    label: "Google Gemini",
    kind: "direct",
    wireFormat: "gemini-generate-content",
    wireFormatEditable: false,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    auth: { type: "header", header: "x-goog-api-key" },
    defaultModel: "gemini-2.5-flash",
    suggestedModels: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro", "gemini-3-flash-preview"],
    envKey: "GEMINI_API_KEY",
    envBaseUrl: "GEMINI_BASE_URL",
    envModel: "GEMINI_MODEL",
    jsonMode: true,
    notes: "Native generateContent API with inline image data and JSON response MIME type.",
    docsUrl: "https://ai.google.dev/gemini-api/docs",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    kind: "direct",
    wireFormat: "anthropic-messages",
    wireFormatEditable: false,
    baseUrl: "https://api.anthropic.com/v1",
    auth: { type: "header", header: "x-api-key" },
    extraHeaders: { "anthropic-version": "2023-06-01" },
    defaultModel: "claude-sonnet-4-5",
    suggestedModels: ["claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-1"],
    envKey: "ANTHROPIC_API_KEY",
    envBaseUrl: "ANTHROPIC_BASE_URL",
    envModel: "ANTHROPIC_MODEL",
    jsonMode: false,
    notes: "Messages API with base64 image blocks. JSON is enforced by the prompt plus the strict validation layer.",
    docsUrl: "https://docs.anthropic.com/",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "direct",
    wireFormat: "openai-chat-completions",
    wireFormatEditable: false,
    baseUrl: "https://api.openai.com/v1",
    auth: { type: "bearer" },
    defaultModel: "gpt-4.1-mini",
    suggestedModels: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o", "gpt-5-mini"],
    envKey: "OPENAI_API_KEY",
    envBaseUrl: "OPENAI_BASE_URL",
    envModel: "OPENAI_MODEL",
    jsonMode: true,
    notes: "Chat Completions with image_url parts and JSON mode.",
    docsUrl: "https://platform.openai.com/docs",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "xkiro",
    label: "xKiro",
    kind: "gateway",
    wireFormat: "openai-chat-completions",
    wireFormatEditable: true,
    baseUrl: "",
    auth: { type: "bearer" },
    defaultModel: "",
    suggestedModels: [],
    envKey: "XKIRO_API_KEY",
    envBaseUrl: "XKIRO_BASE_URL",
    envModel: "XKIRO_MODEL",
    jsonMode: true,
    notes: GATEWAY_NOTES,
  },
  {
    id: "vyce",
    label: "Vyce",
    kind: "gateway",
    wireFormat: "openai-chat-completions",
    wireFormatEditable: true,
    baseUrl: "",
    auth: { type: "bearer" },
    defaultModel: "",
    suggestedModels: [],
    envKey: "VYCE_API_KEY",
    envBaseUrl: "VYCE_BASE_URL",
    envModel: "VYCE_MODEL",
    jsonMode: true,
    notes: GATEWAY_NOTES,
  },
  {
    id: "helyx",
    label: "Helyx",
    kind: "gateway",
    wireFormat: "openai-chat-completions",
    wireFormatEditable: true,
    baseUrl: "",
    auth: { type: "bearer" },
    defaultModel: "",
    suggestedModels: [],
    envKey: "HELYX_API_KEY",
    envBaseUrl: "HELYX_BASE_URL",
    envModel: "HELYX_MODEL",
    jsonMode: true,
    notes: GATEWAY_NOTES,
  },
  {
    id: "agentrouter",
    label: "AgentRouter",
    kind: "gateway",
    wireFormat: "openai-chat-completions",
    wireFormatEditable: true,
    baseUrl: "https://agentrouter.org/v1",
    auth: { type: "bearer" },
    defaultModel: "",
    suggestedModels: [],
    envKey: "AGENTROUTER_API_KEY",
    envBaseUrl: "AGENTROUTER_BASE_URL",
    envModel: "AGENTROUTER_MODEL",
    jsonMode: true,
    notes: GATEWAY_NOTES,
  },
  {
    id: "seekai",
    label: "SeekAi",
    kind: "gateway",
    wireFormat: "openai-chat-completions",
    wireFormatEditable: true,
    baseUrl: "",
    auth: { type: "bearer" },
    defaultModel: "",
    suggestedModels: [],
    envKey: "SEEKAI_API_KEY",
    envBaseUrl: "SEEKAI_BASE_URL",
    envModel: "SEEKAI_MODEL",
    jsonMode: true,
    notes: GATEWAY_NOTES,
  },
];

export function getProviderDef(id: string | null | undefined): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** Provider-specific request-body extras derived from per-slot options. */
export function buildExtraBody(def: ProviderDef, options: ProviderOptions): Record<string, unknown> {
  if (def.id === "deepseek") {
    // Thinking is DeepSeek's default; non-thinking is faster, cheaper and avoids
    // the documented "empty content in JSON mode" behaviour.
    return { thinking: { type: options.thinking ? "enabled" : "disabled" } };
  }
  return {};
}

/** What the browser sees about a provider slot (never includes the key itself). */
export interface ProviderStateDTO {
  id: string;
  label: string;
  kind: "direct" | "gateway";
  isDefault: boolean;
  notes: string;
  pricing: string | null;
  docsUrl: string | null;
  keyUrl: string | null;
  envKey: string;
  defaultBaseUrl: string;
  defaultModel: string;
  suggestedModels: string[];
  legacyModels: Record<string, string>;
  wireFormatEditable: boolean;
  supportsThinkingToggle: boolean;
  // effective values
  baseUrl: string;
  model: string;
  wireFormat: WireFormat;
  enabled: boolean;
  options: ProviderOptions;
  // saved overrides (null = using default/env)
  baseUrlOverride: string | null;
  modelOverride: string | null;
  wireFormatOverride: WireFormat | null;
  hasKey: boolean;
  keySource: "saved" | "env" | null;
  keyPreview: string | null;
  ready: boolean;
  readyReason: string | null;
}
