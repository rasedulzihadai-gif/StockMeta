"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ADOBE_CATEGORIES, ISTOCK_CV_CAVEAT, PLATFORM_SPECS, SHUTTERSTOCK_CATEGORIES } from "@/lib/platforms";
import {
  CONTENT_TYPE_LABEL,
  FLAG_LABEL,
  PLATFORM_IDS,
  needsFileTypeConfirmation,
  type AssetDTO,
  type ContentTypeHint,
  type FileTypeDecision,
  type FlagCode,
  type Issue,
  type MetadataResult,
  type PlatformId,
} from "@/lib/types";
import { copyText } from "@/lib/client/api";
import KeywordEditor from "./KeywordEditor";
import { Badge, Button, CharCounter, Segmented, Spinner, Toggle, cx, inputCls, type Tone } from "./ui";
import { IconAlert, IconCheck, IconCopy, IconInfo, IconLayers, IconImage, IconRefresh, IconSparkles, IconTrash } from "./icons";

export interface AssetDetailProps {
  asset: AssetDTO;
  queued: boolean;
  onGenerate: (id: string) => void;
  onHint: (id: string, hint: ContentTypeHint) => void;
  onFileType: (id: string, t: FileTypeDecision | null) => void;
  onSave: (id: string, result: MetadataResult) => void;
  onDelete: (id: string) => void;
}

const HINT_OPTIONS: { value: ContentTypeHint; label: string }[] = [
  { value: "auto", label: "Auto-detect" },
  { value: "single_asset", label: "Single background" },
  { value: "template_pack", label: "Template / design pack" },
];

const FLAG_TONE: Record<FlagCode, Tone> = {
  POSSIBLE_VECTOR: "sky",
  CONTAINS_TEXT: "fuchsia",
  HINT_MISMATCH: "amber",
  LOW_CONFIDENCE_TYPE: "amber",
  TRADEMARK_RISK: "rose",
  PEOPLE_OR_PROPERTY: "rose",
  QUALITY_CONCERN: "amber",
  OTHER: "zinc",
};

function Field({ label, right, children, hint }: { label: string; right?: ReactNode; children: ReactNode; hint?: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-end justify-between gap-2">
        <div>
          <span className="text-[13px] font-medium text-zinc-200">{label}</span>
          {hint && <span className="ml-2 text-[11px] text-zinc-500">{hint}</span>}
        </div>
        <div className="flex items-center gap-2">{right}</div>
      </div>
      {children}
    </div>
  );
}

function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await copyText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-white"
    >
      {done ? <IconCheck className="h-3 w-3" /> : <IconCopy className="h-3 w-3" />}
      {done ? "Copied" : label}
    </button>
  );
}

function TypeBadge({ ct }: { ct: MetadataResult["content_type"] }) {
  return ct === "template_pack" ? (
    <Badge tone="fuchsia">
      <IconLayers className="h-3 w-3" />
      {CONTENT_TYPE_LABEL[ct]}
    </Badge>
  ) : (
    <Badge tone="sky">
      <IconImage className="h-3 w-3" />
      {CONTENT_TYPE_LABEL[ct]}
    </Badge>
  );
}

export default function AssetDetail({ asset, queued, onGenerate, onHint, onFileType, onSave, onDelete }: AssetDetailProps) {
  const [draft, setDraft] = useState<MetadataResult | null>(asset.result);
  const tabs = PLATFORM_IDS.filter((p) => !!draft?.platforms[p]);
  const [tab, setTab] = useState<PlatformId>(tabs[0] ?? "adobe");
  const activeTab: PlatformId | undefined = tabs.includes(tab) ? tab : tabs[0];
  const draftRef = useRef<MetadataResult | null>(asset.result);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = asset.status === "processing" || queued;

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (dirty.current && draftRef.current) {
      dirty.current = false;
      onSave(asset.id, draftRef.current);
    }
  }, [asset.id, onSave]);
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  useEffect(() => () => flushRef.current(), []);

  const edit = (mut: (r: MetadataResult) => void) => {
    if (!draft) return;
    const next = structuredClone(draft);
    mut(next);
    setDraft(next);
    draftRef.current = next;
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), 700);
  };

  const result = asset.result;
  const mismatch = !!result && asset.hint !== "auto" && asset.hint !== result.content_type;
  const flagged = !!result?.flags.some((f) => f.code === "POSSIBLE_VECTOR");
  const pendingType = needsFileTypeConfirmation(asset);
  const modelCt = asset.usage?.modelContentType;

  const renderPlatform = (p: PlatformId) => {
    const spec = PLATFORM_SPECS[p];
    const P = draft?.platforms;
    if (!P) return null;
    if (p === "adobe" && P.adobe) {
      const a = P.adobe;
      return (
        <>
          <Field label="Title" hint="≤70 real ceiling" right={<><CharCounter length={a.title.length} max={spec.titleMax} hardMax={spec.titleHardMax} /><CopyBtn text={a.title} /></>}>
            <input className={inputCls} value={a.title} onChange={(e) => edit((r) => void (r.platforms.adobe!.title = e.target.value))} onBlur={flush} />
          </Field>
          <Field label="Keywords" hint="max 49" right={<CopyBtn text={a.keywords.join(", ")} />}>
            <KeywordEditor keywords={a.keywords} max={spec.keywordsMax} min={spec.keywordsMin} onChange={(k) => edit((r) => void (r.platforms.adobe!.keywords = k))} />
          </Field>
          <Field label="Category">
            <select className={inputCls} value={a.category} onChange={(e) => edit((r) => void (r.platforms.adobe!.category = Number(e.target.value)))}>
              {Object.entries(ADOBE_CATEGORIES).map(([n, l]) => (
                <option key={n} value={n}>
                  {n} · {l}
                </option>
              ))}
            </select>
          </Field>
        </>
      );
    }
    if (p === "shutterstock" && P.shutterstock) {
      const s = P.shutterstock;
      return (
        <>
          <Field label="Description" hint="buyer-facing title sentence" right={<><CharCounter length={s.description.length} max={spec.titleMax} /><CopyBtn text={s.description} /></>}>
            <textarea rows={3} className={cx(inputCls, "resize-y")} value={s.description} onChange={(e) => edit((r) => void (r.platforms.shutterstock!.description = e.target.value))} onBlur={flush} />
          </Field>
          <Field label="Keywords" hint="7–50" right={<CopyBtn text={s.keywords.join(", ")} />}>
            <KeywordEditor keywords={s.keywords} max={spec.keywordsMax} min={spec.keywordsMin} onChange={(k) => edit((r) => void (r.platforms.shutterstock!.keywords = k))} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <Field key={i} label={i === 0 ? "Primary category" : "Secondary category"}>
                <select
                  className={inputCls}
                  value={s.categories[i] ?? ""}
                  onChange={(e) =>
                    edit((r) => {
                      const cats = [...r.platforms.shutterstock!.categories];
                      if (e.target.value) cats[i] = e.target.value;
                      else cats.splice(i, 1);
                      r.platforms.shutterstock!.categories = Array.from(new Set(cats.filter(Boolean))).slice(0, 2);
                    })
                  }
                >
                  {i === 1 && <option value="">— none —</option>}
                  {SHUTTERSTOCK_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          <Toggle
            checked={asset.fileType === "vector" || s.illustration}
            disabled={asset.fileType === "vector"}
            onChange={(v) => edit((r) => void (r.platforms.shutterstock!.illustration = v))}
            label={<span>Illustration {asset.fileType === "vector" && <span className="text-xs text-zinc-500">(confirmed vector)</span>}</span>}
          />
        </>
      );
    }
    if (p === "freepik" && P.freepik) {
      const f = P.freepik;
      return (
        <>
          <Field label="Title" hint="≤70 real ceiling" right={<><CharCounter length={f.title.length} max={spec.titleMax} hardMax={spec.titleHardMax} /><CopyBtn text={f.title} /></>}>
            <input className={inputCls} value={f.title} onChange={(e) => edit((r) => void (r.platforms.freepik!.title = e.target.value))} onBlur={flush} />
          </Field>
          <Field label="Keywords" hint="20–50" right={<CopyBtn text={f.keywords.join(", ")} />}>
            <KeywordEditor keywords={f.keywords} max={spec.keywordsMax} min={spec.keywordsMin} onChange={(k) => edit((r) => void (r.platforms.freepik!.keywords = k))} />
          </Field>
        </>
      );
    }
    if (p === "istock" && P.istock) {
      const i = P.istock;
      return (
        <>
          <div className="flex gap-2 rounded-lg bg-sky-500/[0.07] px-3 py-2 text-xs text-sky-200/90 ring-1 ring-sky-500/20">
            <IconInfo className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {ISTOCK_CV_CAVEAT}
          </div>
          <Field label="Title" right={<><CharCounter length={i.title.length} max={spec.titleMax} /><CopyBtn text={i.title} /></>}>
            <input className={inputCls} value={i.title} onChange={(e) => edit((r) => void (r.platforms.istock!.title = e.target.value))} onBlur={flush} />
          </Field>
          <Field label="Description" right={<><CharCounter length={i.description.length} max={spec.descriptionMax ?? 200} /><CopyBtn text={i.description} /></>}>
            <textarea rows={3} className={cx(inputCls, "resize-y")} value={i.description} onChange={(e) => edit((r) => void (r.platforms.istock!.description = e.target.value))} onBlur={flush} />
          </Field>
          <Field label="Keywords" hint="25–50 · controlled vocabulary" right={<CopyBtn text={i.keywords.join(", ")} />}>
            <KeywordEditor keywords={i.keywords} max={spec.keywordsMax} min={spec.keywordsMin} onChange={(k) => edit((r) => void (r.platforms.istock!.keywords = k))} />
          </Field>
        </>
      );
    }
    return null;
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-white" title={asset.filename}>
            {asset.filename}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
            <span>
              {asset.width}×{asset.height}px
            </span>
            {asset.vectorCompanion && <Badge tone="sky">paired with {asset.vectorCompanion}</Badge>}
            {asset.model && (
              <span>
                · {asset.providerId} / {asset.model}
              </span>
            )}
            {asset.usage && (
              <span>
                · {(asset.usage.latencyMs / 1000).toFixed(1)}s · {asset.usage.inputTokens + asset.usage.outputTokens} tokens
                {asset.usage.attempts > 1 ? ` · ${asset.usage.attempts} calls` : ""}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={result ? "secondary" : "primary"}
            onClick={() => {
              flush();
              onGenerate(asset.id);
            }}
            disabled={busy}
          >
            {busy ? <Spinner /> : result ? <IconRefresh /> : <IconSparkles />}
            {busy ? (queued ? "Queued" : "Generating…") : result ? "Regenerate" : "Generate metadata"}
          </Button>
          <Button variant="ghost" onClick={() => onDelete(asset.id)} aria-label="Delete file" title="Delete file">
            <IconTrash />
          </Button>
        </div>
      </div>

      {/* preview + type controls */}
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="checker relative flex min-h-[220px] items-center justify-center overflow-hidden rounded-2xl border border-zinc-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/assets/${asset.id}/image`} alt={asset.filename} className="max-h-[360px] w-full object-contain" />
          {busy && (
            <div className="absolute inset-0 grid place-items-center bg-black/55 backdrop-blur-[1px]">
              <div className="flex items-center gap-2 rounded-full bg-zinc-950/80 px-4 py-2 text-sm text-violet-200 ring-1 ring-violet-500/30">
                <Spinner className="h-4 w-4" />
                {queued ? "Queued…" : "Classifying & writing metadata…"}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Content type</span>
              {result ? <TypeBadge ct={result.content_type} /> : <span className="text-xs text-zinc-500">not generated yet</span>}
            </div>
            <Segmented className="mt-3" size="sm" stretch value={asset.hint} options={HINT_OPTIONS} onChange={(h) => onHint(asset.id, h)} />
            <p className="mt-2 text-xs leading-relaxed text-zinc-500">
              {asset.hint === "auto"
                ? "The vision model classifies the upload first, then applies the matching rule set."
                : "Your hint is authoritative — the model must follow that rule set."}
            </p>
            {mismatch && (
              <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200 ring-1 ring-amber-500/30">
                <span>The hint differs from the convention this metadata was written in.</span>
                <Button size="xs" variant="subtle" onClick={() => onGenerate(asset.id)} disabled={busy}>
                  Regenerate
                </Button>
              </div>
            )}
            {result && (
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-zinc-800/80 pt-3 text-xs">
                <div>
                  <div className="text-zinc-500">Category suggestion</div>
                  <div className="mt-0.5 font-medium text-zinc-100">{result.category_suggestion || "—"}</div>
                </div>
                <div>
                  <div className="text-zinc-500">Rule set applied</div>
                  <div className="mt-0.5 font-medium text-zinc-100">{result.content_type === "template_pack" ? "A–F + H–K" : "A–G"}</div>
                </div>
                {modelCt && modelCt !== result.content_type && (
                  <div className="col-span-2 text-amber-300/90">Model&apos;s own reading: {modelCt} — overridden by your hint.</div>
                )}
              </div>
            )}
          </div>

          {(flagged || asset.fileType) && (
            <div className={cx("rounded-xl border p-4", pendingType ? "border-amber-500/40 bg-amber-500/[0.06]" : "border-zinc-800 bg-zinc-900/40")}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Actual file type</span>
                {pendingType ? (
                  <Badge tone="amber">Confirm before export</Badge>
                ) : asset.fileType ? (
                  <Badge tone="emerald">{asset.fileType === "vector" ? "Vector (AI / EPS)" : "Raster (JPEG / PNG)"}</Badge>
                ) : null}
              </div>
              {flagged && (
                <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                  The preview looks like vector artwork, but a JPEG preview can&apos;t prove the real format. What will you actually upload?
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant={asset.fileType === "vector" ? "primary" : "subtle"} onClick={() => onFileType(asset.id, "vector")}>
                  Vector (AI / EPS)
                </Button>
                <Button size="sm" variant={asset.fileType === "raster" ? "primary" : "subtle"} onClick={() => onFileType(asset.id, "raster")}>
                  Raster (JPEG / PNG)
                </Button>
              </div>
              {asset.fileType === "raster" && result && (
                <p className="mt-2 text-[11px] text-zinc-500">Vector wording is removed from titles and keywords (rule D). Regenerate to restore it if you switch back.</p>
              )}
            </div>
          )}

          {result && result.flags.length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Flags</span>
              <ul className="mt-2 space-y-1.5">
                {result.flags.map((f) => (
                  <li key={f.code} className="flex items-start gap-2 text-xs">
                    <Badge tone={FLAG_TONE[f.code]}>{FLAG_LABEL[f.code]}</Badge>
                    <span className="pt-0.5 text-zinc-400">{f.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {asset.status === "error" && asset.error && (
            <div className="flex gap-2 rounded-xl border border-rose-500/30 bg-rose-500/[0.07] p-4 text-sm text-rose-200">
              <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-words">{asset.error}</span>
            </div>
          )}

          {result?.description && <p className="px-1 text-xs leading-relaxed text-zinc-500">{result.description}</p>}
        </div>
      </div>

      {/* platform editors */}
      {draft && activeTab ? (
        <section className="mt-7">
          <div className="scroll-thin flex items-center gap-1 overflow-x-auto border-b border-zinc-800">
            {tabs.map((p) => {
              const n = asset.issues.filter((i) => i.platform === p && i.level !== "fixed").length;
              const errs = asset.issues.some((i) => i.platform === p && i.level === "error");
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setTab(p)}
                  className={cx(
                    "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                    activeTab === p ? "border-violet-500 text-white" : "border-transparent text-zinc-400 hover:text-zinc-200",
                  )}
                >
                  {PLATFORM_SPECS[p].label}
                  {n > 0 && (
                    <span className={cx("rounded px-1 text-[10px] tabular-nums", errs ? "bg-rose-500/20 text-rose-300" : "bg-amber-500/15 text-amber-300")}>{n}</span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-4 space-y-4">{renderPlatform(activeTab)}</div>
          <IssuesPanel issues={asset.issues} tab={activeTab} />
        </section>
      ) : !busy && !result ? (
        <div className="mt-7 rounded-2xl border border-dashed border-zinc-800 p-8 text-center">
          <IconSparkles className="mx-auto h-6 w-6 text-violet-300" />
          <p className="mt-2 text-sm text-zinc-300">No metadata yet.</p>
          <p className="mt-1 text-xs text-zinc-500">Pick a content-type hint (or leave Auto-detect) and generate.</p>
        </div>
      ) : null}
    </div>
  );
}

function IssuesPanel({ issues, tab }: { issues: Issue[]; tab: PlatformId }) {
  const relevant = issues.filter((i) => !i.platform || i.platform === tab);
  const order = { error: 0, warning: 1, fixed: 2 } as const;
  const sorted = [...relevant].sort((a, b) => order[a.level] - order[b.level]);
  if (!sorted.length)
    return (
      <div className="mt-5 flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300">
        <IconCheck />
        Every strict validation check passes for {PLATFORM_SPECS[tab].short}.
      </div>
    );
  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/30">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Validation layer</span>
        <span className="text-[11px] text-zinc-500">
          {relevant.filter((i) => i.level === "fixed").length} auto-fixed · {relevant.filter((i) => i.level === "warning").length} warnings ·{" "}
          {relevant.filter((i) => i.level === "error").length} errors
        </span>
      </div>
      <ul className="divide-y divide-zinc-800/70">
        {sorted.map((i, idx) => (
          <li key={idx} className="flex items-start gap-2.5 px-4 py-2 text-[13px]">
            {i.level === "error" ? (
              <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
            ) : i.level === "warning" ? (
              <IconInfo className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
            ) : (
              <IconCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
            )}
            <span className="mt-px w-12 shrink-0 font-mono text-[11px] text-zinc-500">{i.rule}</span>
            <span className={cx(i.level === "error" ? "text-rose-200" : i.level === "warning" ? "text-amber-100/90" : "text-zinc-400")}>{i.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
