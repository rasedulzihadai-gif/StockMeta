// Wire-format adapters: OpenAI Chat Completions (DeepSeek, OpenAI, most gateways),
// Anthropic Messages and Gemini generateContent — plus retry/backoff and error mapping.

import { ProviderError, toProviderError } from "./errors";
import type { ResolvedProviderConfig } from "./providers";
import { solidPngBase64 } from "./png";

export type ChatTurn =
  | { role: "user"; text: string; image?: { base64: string; mime: string } }
  | { role: "assistant"; text: string };

export interface CallRequest {
  system: string;
  turns: ChatTurn[];
  maxTokens: number;
  temperature: number;
  json: boolean;
}

export interface CallResponse {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  finishReason: string | null;
}

// Provider responses are untyped JSON; every access below is defensive.
type Json = any;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Human explanation for fetch-level failures — users routinely read these as
 *  "my API key is wrong", so say explicitly what actually happened. */
function networkErrorMessage(host: string, e: unknown): string {
  const err = e as Error;
  const cause = (e as { cause?: { code?: unknown } })?.cause;
  const code = typeof cause?.code === "string" ? cause.code : "";
  const reason =
    code === "ENOTFOUND" || code === "EAI_AGAIN"
      ? `the server couldn't resolve ${host} (no DNS/internet access)`
      : code === "ECONNREFUSED"
        ? `connection refused by ${host} — check the Base URL`
        : code === "ENETUNREACH" || code === "EHOSTUNREACH"
          ? `no network route to ${host}`
          : code || err?.message || String(e);
  return (
    `Couldn't reach ${host} — ${reason}. ` +
    `This is a network problem, NOT an API key problem. ` +
    `Hosted preview sandboxes usually have no outbound internet: run the app on your own machine ` +
    `(npm install && npm run dev) or wherever the provider API is reachable.`
  );
}

function parseRetryAfter(v: string | null): number | undefined {
  if (!v) return undefined;
  const s = Number(v);
  if (Number.isFinite(s)) return Math.min(60_000, s * 1000);
  const d = Date.parse(v);
  return Number.isFinite(d) ? Math.min(60_000, Math.max(0, d - Date.now())) : undefined;
}

function errorMessage(data: Json, text: string): string {
  const m =
    data?.error?.message ??
    data?.error?.msg ??
    (typeof data?.error === "string" ? data.error : undefined) ??
    data?.message ??
    data?.detail ??
    "";
  return String(m || text || "").slice(0, 400);
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<{ status: number; data: Json; text: string; headers: Headers }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const err = e as Error;
    if (err?.name === "TimeoutError" || err?.name === "AbortError")
      throw new ProviderError("timeout", `Request timed out after ${Math.round(timeoutMs / 1000)}s`, { retryable: true });
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      /* keep url */
    }
    throw new ProviderError("network", networkErrorMessage(host, e), { retryable: true });
  }
  const text = await res.text();
  let data: Json = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { status: res.status, data, text, headers: res.headers };
}

function httpError(label: string, status: number, data: Json, text: string, headers: Headers): ProviderError {
  const msg = errorMessage(data, text) || `HTTP ${status}`;
  const retryAfterMs = parseRetryAfter(headers.get("retry-after"));
  if (status === 401 || status === 403)
    return new ProviderError("auth", `${label}: authentication failed — check the API key (${msg})`, { status });
  if (status === 402)
    return new ProviderError("billing", `${label}: insufficient balance / billing required (${msg})`, { status });
  if (status === 404)
    return new ProviderError("not_found", `${label}: model or endpoint not found — check the model ID and base URL (${msg})`, { status });
  if (status === 408) return new ProviderError("timeout", `${label}: request timeout (${msg})`, { status, retryable: true });
  if (status === 429)
    return new ProviderError("rate_limit", `${label}: rate limited (${msg})`, { status, retryable: true, retryAfterMs });
  if (status >= 500)
    return new ProviderError("server", `${label}: server error ${status} (${msg})`, { status, retryable: true, retryAfterMs });
  return new ProviderError("bad_request", `${label}: request rejected (${status}) — ${msg}`, { status });
}

function authHeaders(cfg: ResolvedProviderConfig): Record<string, string> {
  const h: Record<string, string> = { ...cfg.extraHeaders };
  if (cfg.def.auth.type === "bearer") h.authorization = `Bearer ${cfg.apiKey}`;
  else h[cfg.def.auth.header] = cfg.apiKey;
  // Gateways speaking the Anthropic format usually accept either header.
  if (cfg.def.kind === "gateway" && cfg.wireFormat === "anthropic-messages") {
    h["x-api-key"] = cfg.apiKey;
    h["anthropic-version"] = h["anthropic-version"] ?? "2023-06-01";
  }
  if (cfg.def.kind === "gateway" && cfg.wireFormat === "gemini-generate-content") h["x-goog-api-key"] = cfg.apiKey;
  return h;
}

/* ---------------- OpenAI Chat Completions ---------------- */
async function callOpenAIChat(cfg: ResolvedProviderConfig, req: CallRequest): Promise<CallResponse> {
  const url = `${cfg.baseUrl}/chat/completions`;
  const messages: Json[] = [{ role: "system", content: req.system }];
  for (const t of req.turns) {
    if (t.role === "user") {
      const content: Json[] = [{ type: "text", text: t.text }];
      if (t.image) content.push({ type: "image_url", image_url: { url: `data:${t.image.mime};base64,${t.image.base64}` } });
      messages.push({ role: "user", content });
    } else messages.push({ role: "assistant", content: t.text });
  }
  const reasoningModel = /^(o\d|gpt-5)/i.test(cfg.model);
  const body: Record<string, unknown> = { model: cfg.model, messages };
  if (cfg.id === "openai") body.max_completion_tokens = req.maxTokens;
  else body.max_tokens = cfg.options.thinking ? Math.max(req.maxTokens, 8000) : req.maxTokens;
  if (!reasoningModel && !cfg.options.thinking) body.temperature = req.temperature;
  if (req.json && cfg.jsonMode) body.response_format = { type: "json_object" };
  Object.assign(body, cfg.extraBody);

  const headers = authHeaders(cfg);
  let r = await postJson(url, headers, body, cfg.timeoutMs);
  if (r.status === 400 && ("response_format" in body || Object.keys(cfg.extraBody).length)) {
    const msg = errorMessage(r.data, r.text);
    if (/response_format|json_object|json mode|thinking|unknown|unrecognized|not support|unsupported|extra/i.test(msg)) {
      const retryBody = { ...body };
      delete retryBody.response_format;
      for (const k of Object.keys(cfg.extraBody)) delete retryBody[k];
      r = await postJson(url, headers, retryBody, cfg.timeoutMs);
    }
  }
  if (r.status < 200 || r.status >= 300) throw httpError(cfg.label, r.status, r.data, r.text, r.headers);
  const choice = r.data?.choices?.[0];
  const content = choice?.message?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((p: Json) => (typeof p?.text === "string" ? p.text : "")).join("")
        : "";
  if (!text.trim())
    throw new ProviderError("empty", `${cfg.label} returned an empty response (finish_reason: ${choice?.finish_reason ?? "unknown"})`, {
      retryable: true,
    });
  return {
    text,
    model: r.data?.model || cfg.model,
    inputTokens: Number(r.data?.usage?.prompt_tokens ?? 0),
    outputTokens: Number(r.data?.usage?.completion_tokens ?? 0),
    finishReason: choice?.finish_reason ?? null,
  };
}

/* ---------------- Anthropic Messages ---------------- */
async function callAnthropic(cfg: ResolvedProviderConfig, req: CallRequest): Promise<CallResponse> {
  const url = `${cfg.baseUrl}/messages`;
  const messages = req.turns.map((t) =>
    t.role === "user"
      ? {
          role: "user",
          content: [
            ...(t.image ? [{ type: "image", source: { type: "base64", media_type: t.image.mime, data: t.image.base64 } }] : []),
            { type: "text", text: t.text },
          ],
        }
      : { role: "assistant", content: [{ type: "text", text: t.text }] },
  );
  const body = { model: cfg.model, system: req.system, max_tokens: req.maxTokens, temperature: req.temperature, messages };
  const r = await postJson(url, authHeaders(cfg), body, cfg.timeoutMs);
  if (r.status < 200 || r.status >= 300) throw httpError(cfg.label, r.status, r.data, r.text, r.headers);
  const blocks: Json[] = Array.isArray(r.data?.content) ? r.data.content : [];
  const text = blocks.filter((b) => b?.type === "text").map((b) => String(b.text ?? "")).join("");
  if (!text.trim())
    throw new ProviderError("empty", `${cfg.label} returned an empty response (stop_reason: ${r.data?.stop_reason ?? "unknown"})`, {
      retryable: true,
    });
  return {
    text,
    model: r.data?.model || cfg.model,
    inputTokens: Number(r.data?.usage?.input_tokens ?? 0),
    outputTokens: Number(r.data?.usage?.output_tokens ?? 0),
    finishReason: r.data?.stop_reason ?? null,
  };
}

/* ---------------- Gemini generateContent ---------------- */
async function callGemini(cfg: ResolvedProviderConfig, req: CallRequest): Promise<CallResponse> {
  const url = `${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}:generateContent`;
  const contents = req.turns.map((t) => ({
    role: t.role === "user" ? "user" : "model",
    parts:
      t.role === "user"
        ? [...(t.image ? [{ inlineData: { mimeType: t.image.mime, data: t.image.base64 } }] : []), { text: t.text }]
        : [{ text: t.text }],
  }));
  const body = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents,
    generationConfig: {
      temperature: req.temperature,
      maxOutputTokens: Math.max(req.maxTokens, 8192),
      ...(req.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  const r = await postJson(url, authHeaders(cfg), body, cfg.timeoutMs);
  if (r.status < 200 || r.status >= 300) throw httpError(cfg.label, r.status, r.data, r.text, r.headers);
  const cand = r.data?.candidates?.[0];
  const parts: Json[] = Array.isArray(cand?.content?.parts) ? cand.content.parts : [];
  const text = parts.filter((p) => !p?.thought).map((p) => String(p?.text ?? "")).join("");
  if (!text.trim()) {
    const blocked = r.data?.promptFeedback?.blockReason;
    if (blocked) throw new ProviderError("bad_request", `${cfg.label}: request blocked (${blocked})`);
    throw new ProviderError("empty", `${cfg.label} returned an empty response (finishReason: ${cand?.finishReason ?? "unknown"})`, {
      retryable: true,
    });
  }
  return {
    text,
    model: r.data?.modelVersion || cfg.model,
    inputTokens: Number(r.data?.usageMetadata?.promptTokenCount ?? 0),
    outputTokens: Number(r.data?.usageMetadata?.candidatesTokenCount ?? 0),
    finishReason: cand?.finishReason ?? null,
  };
}

export async function callProvider(cfg: ResolvedProviderConfig, req: CallRequest): Promise<CallResponse> {
  switch (cfg.wireFormat) {
    case "anthropic-messages":
      return callAnthropic(cfg, req);
    case "gemini-generate-content":
      return callGemini(cfg, req);
    default:
      return callOpenAIChat(cfg, req);
  }
}

/** Retries transient failures (429/5xx/timeouts/empty) with exponential backoff. */
export async function callWithRetry(cfg: ResolvedProviderConfig, req: CallRequest, maxRetries = 2): Promise<CallResponse> {
  let attempt = 0;
  let json = req.json;
  for (;;) {
    try {
      return await callProvider(cfg, { ...req, json });
    } catch (e) {
      const pe = toProviderError(e);
      // DeepSeek documents occasional empty content in JSON mode — retry without it.
      if (pe.code === "empty" && json) json = false;
      if (!pe.retryable || attempt >= maxRetries) throw pe;
      attempt++;
      await sleep(pe.retryAfterMs ?? Math.min(15_000, 1200 * 2 ** (attempt - 1) + Math.random() * 400));
    }
  }
}

/** Tiny vision round-trip: proves auth, model ID, image input and JSON output in one call. */
export async function testProviderConnection(cfg: ResolvedProviderConfig) {
  const t0 = Date.now();
  const res = await callProvider(cfg, {
    system: "You are a vision API. Answer with one JSON object only.",
    turns: [
      {
        role: "user",
        text: 'Which single color fills this image? Reply as JSON: {"ok": true, "color": "<one word>"}',
        image: { base64: solidPngBase64(64, 64, [37, 99, 235]), mime: "image/png" },
      },
    ],
    maxTokens: 120,
    temperature: 0,
    json: true,
  });
  return { ok: true as const, latencyMs: Date.now() - t0, model: res.model, reply: res.text.trim().slice(0, 240) };
}
