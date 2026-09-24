"use client";

import { useState } from "react";
import { WIRE_FORMATS, type ProviderStateDTO, type WireFormat } from "@/lib/providers/registry";
import { PLATFORM_SPECS } from "@/lib/platforms";
import { PLATFORM_IDS, type AppSettingsDTO, type ServerInfoDTO } from "@/lib/types";
import { api, errMsg } from "@/lib/client/api";
import { Badge, Button, Modal, Spinner, Toggle, cx, inputCls } from "./ui";
import { ServerWarnings } from "./ServerBanners";
import { IconCheck, IconChevron, IconFlask, IconKey } from "./icons";

interface Props {
  open: boolean;
  onClose: () => void;
  providers: ProviderStateDTO[];
  settings: AppSettingsDTO;
  serverInfo?: ServerInfoDTO | null;
  onProvider: (p: ProviderStateDTO) => void;
  onSettings: (patch: Partial<AppSettingsDTO>) => void;
  onOpenSelfTest: () => void;
}

export default function SettingsModal({ open, onClose, providers, settings, serverInfo, onProvider, onSettings, onOpenSelfTest }: Props) {
  const [expanded, setExpanded] = useState<string | null>(settings.activeProviderId);
  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-4xl"
      title="Settings"
      subtitle="DeepSeek is pre-selected as the primary provider. Every other slot stays available and is configured independently — API keys are stored server-side and never sent back to the browser."
    >
      {serverInfo && <ServerWarnings info={serverInfo} compact />}
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Generation</h3>
        <div className="mt-3 grid gap-5 sm:grid-cols-2">
          <div>
            <div className="mb-2 text-sm text-zinc-300">Platforms to generate</div>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORM_IDS.map((p) => {
                const on = settings.platforms.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      const next = on ? settings.platforms.filter((x) => x !== p) : [...settings.platforms, p];
                      if (next.length) onSettings({ platforms: PLATFORM_IDS.filter((x) => next.includes(x)) });
                    }}
                    className={cx(
                      "rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition",
                      on ? "bg-violet-500/15 text-violet-200 ring-violet-500/40" : "text-zinc-500 ring-zinc-800 hover:text-zinc-300",
                    )}
                  >
                    {PLATFORM_SPECS[p].label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between text-sm text-zinc-300">
              <span>Parallel requests</span>
              <span className="tabular-nums text-zinc-500">{settings.concurrency}</span>
            </div>
            <input
              type="range"
              min={1}
              max={8}
              value={settings.concurrency}
              onChange={(e) => onSettings({ concurrency: Number(e.target.value) })}
              className="w-full accent-violet-500"
              aria-label="Parallel requests"
            />
          </div>
        </div>
      </section>

      <section className="mt-7">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">AI providers</h3>
          <Button size="sm" variant="ghost" onClick={onOpenSelfTest}>
            <IconFlask />
            Acceptance test
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {providers.map((p) => (
            <ProviderCard
              key={p.id}
              p={p}
              active={p.id === settings.activeProviderId}
              expanded={expanded === p.id}
              onToggle={() => setExpanded(expanded === p.id ? null : p.id)}
              onSaved={onProvider}
              onActivate={() => onSettings({ activeProviderId: p.id })}
            />
          ))}
        </div>
      </section>
    </Modal>
  );
}

function ProviderCard({
  p,
  active,
  expanded,
  onToggle,
  onSaved,
  onActivate,
}: {
  p: ProviderStateDTO;
  active: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSaved: (p: ProviderStateDTO) => void;
  onActivate: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(p.baseUrlOverride ?? "");
  const [model, setModel] = useState(p.modelOverride ?? "");
  const [wire, setWire] = useState<WireFormat | "">(p.wireFormatOverride ?? "");
  const [thinking, setThinking] = useState(!!p.options.thinking);
  const [enabled, setEnabled] = useState(p.enabled);
  const [busy, setBusy] = useState<null | "save" | "test" | "clear">(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const effectiveModel = model.trim() || p.defaultModel;
  const legacyTarget = p.legacyModels[effectiveModel];
  const dirty =
    !!apiKey.trim() ||
    baseUrl.trim() !== (p.baseUrlOverride ?? "") ||
    model.trim() !== (p.modelOverride ?? "") ||
    wire !== (p.wireFormatOverride ?? "") ||
    thinking !== !!p.options.thinking ||
    enabled !== p.enabled;

  const save = async (clearKey = false) => {
    const body: Record<string, unknown> = { baseUrl: baseUrl.trim() || null, model: model.trim() || null, enabled, options: { thinking } };
    if (p.wireFormatEditable) body.wireFormat = wire || null;
    if (clearKey) body.apiKey = null;
    else if (apiKey.trim()) body.apiKey = apiKey.trim();
    const r = await api<{ provider: ProviderStateDTO }>(`/api/providers/${p.id}`, { method: "PUT", json: body });
    onSaved(r.provider);
    setApiKey("");
    return r.provider;
  };

  const run = async (kind: "save" | "test" | "clear") => {
    setBusy(kind);
    setMsg(null);
    try {
      if (kind === "clear") {
        await save(true);
        setMsg({ ok: true, text: "Saved key removed" });
      } else if (kind === "save") {
        await save();
        setMsg({ ok: true, text: "Saved" });
      } else {
        if (dirty) await save();
        const r = await api<{ ok: boolean; error?: string; latencyMs?: number; model?: string; reply?: string }>(`/api/providers/${p.id}/test`, {
          method: "POST",
        });
        setMsg(r.ok ? { ok: true, text: `Vision round-trip OK · ${r.model} · ${r.latencyMs} ms · ${r.reply}` } : { ok: false, text: r.error ?? "Test failed" });
      }
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={cx("rounded-xl border transition", active ? "border-violet-500/50 bg-violet-500/[0.04]" : "border-zinc-800 bg-zinc-900/30")}>
      <div className="flex items-center gap-3 px-4 py-3">
        <input type="radio" name="active-provider" checked={active} onChange={onActivate} className="accent-violet-500" aria-label={`Use ${p.label}`} />
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="font-medium text-zinc-100">{p.label}</span>
          {p.isDefault && <Badge tone="violet">Default</Badge>}
          {p.kind === "gateway" && <Badge>Gateway</Badge>}
          <span className="hidden truncate text-xs text-zinc-500 sm:inline">{p.model || "no model set"}</span>
          <span className="ml-auto">
            {p.ready ? (
              <Badge tone="emerald">
                <IconCheck className="h-3 w-3" />
                Ready
              </Badge>
            ) : (
              <Badge tone="amber">{p.readyReason}</Badge>
            )}
          </span>
          <IconChevron className={cx("h-4 w-4 shrink-0 text-zinc-500 transition", expanded && "rotate-180")} />
        </button>
      </div>
      {expanded && (
        <div className="space-y-4 border-t border-zinc-800/80 px-4 py-4">
          <p className="text-xs leading-relaxed text-zinc-400">
            {p.notes}
            {p.pricing && <span className="ml-1 text-emerald-300/90">{p.pricing}</span>}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
                <span className="flex items-center gap-1">
                  <IconKey className="h-3.5 w-3.5" />
                  API key <span className="text-zinc-600">· Authorization header set by the adapter</span>
                </span>
                <span>
                  {p.hasKey ? `${p.keySource === "env" ? `from ${p.envKey}` : "saved"} · ${p.keyPreview}` : `not set (or env ${p.envKey})`}
                  {p.keyUrl && (
                    <a href={p.keyUrl} target="_blank" rel="noreferrer" className="ml-2 text-violet-300 hover:underline">
                      get a key ↗
                    </a>
                  )}
                </span>
              </span>
              <div className="flex gap-2">
                <input
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={p.hasKey ? "•••••••• (leave empty to keep the current key)" : "Paste API key"}
                  className={inputCls}
                />
                {p.keySource === "saved" && (
                  <Button size="sm" variant="ghost" className="h-auto" onClick={() => run("clear")} disabled={!!busy}>
                    Remove
                  </Button>
                )}
              </div>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Base URL</span>
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={p.defaultBaseUrl || "https://your-gateway.example/v1"} className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Model ID</span>
              <input list={`models-${p.id}`} value={model} onChange={(e) => setModel(e.target.value)} placeholder={p.defaultModel || "vision-capable model ID"} className={inputCls} />
              <datalist id={`models-${p.id}`}>
                {p.suggestedModels.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            {p.wireFormatEditable && (
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-400">Wire format</span>
                <select value={wire} onChange={(e) => setWire(e.target.value as WireFormat | "")} className={inputCls}>
                  <option value="">Default — OpenAI Chat Completions</option>
                  {WIRE_FORMATS.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {legacyTarget && (
            <p className="text-xs text-amber-300/90">
              “{effectiveModel}” is a legacy ID — it still works (routes to the same model), but prefer “{legacyTarget}”.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-5">
            <Toggle checked={enabled} onChange={setEnabled} label="Enabled" />
            {p.supportsThinkingToggle && <Toggle checked={thinking} onChange={setThinking} label="Thinking mode (slower, more tokens)" />}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => run("save")} disabled={!!busy || !dirty}>
              {busy === "save" && <Spinner className="h-3.5 w-3.5" />}
              Save
            </Button>
            <Button size="sm" onClick={() => run("test")} disabled={!!busy}>
              {busy === "test" && <Spinner className="h-3.5 w-3.5" />}
              Test connection
            </Button>
            {!active && (
              <Button size="sm" variant="ghost" onClick={onActivate}>
                Use this provider
              </Button>
            )}
            {msg && <span className={cx("break-all text-xs", msg.ok ? "text-emerald-300" : "text-rose-300")}>{msg.text}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
