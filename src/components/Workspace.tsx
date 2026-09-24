"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ProviderStateDTO } from "@/lib/providers/registry";
import type { InitialData } from "@/lib/server/data";
import { SAMPLE_IMAGES } from "@/lib/acceptance";
import { PLATFORM_SPECS } from "@/lib/platforms";
import {
  PLATFORM_IDS,
  needsReview,
  type AppSettingsDTO,
  type AssetDTO,
  type ContentTypeHint,
  type FileTypeDecision,
  type MetadataResult,
  type ServerInfoDTO,
} from "@/lib/types";
import { api, errMsg, runPool } from "@/lib/client/api";
import { processImage } from "@/lib/client/image";
import AssetList from "./AssetList";
import AssetDetail from "./AssetDetail";
import SettingsModal from "./SettingsModal";
import ExportModal from "./ExportModal";
import SelfTestModal from "./SelfTestModal";
import { ServerWarnings } from "./ServerBanners";
import { Badge, Button, Segmented, Spinner, cx, type Tone } from "./ui";
import { IconDownload, IconFlask, IconImage, IconLayers, IconLogo, IconSettings, IconSparkles, IconStop, IconUpload } from "./icons";

type Filter = "all" | "pending" | "done" | "review" | "error";
type Toast = { id: number; text: string; tone: "info" | "success" | "error" };

const HINT_OPTIONS: { value: ContentTypeHint; label: string }[] = [
  { value: "auto", label: "Auto-detect" },
  { value: "single_asset", label: "Single background" },
  { value: "template_pack", label: "Template / design pack" },
];
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "done", label: "Done" },
  { id: "review", label: "Review" },
  { id: "error", label: "Errors" },
];
const VECTOR_RE = /\.(eps|ai|pdf)$/i;
const RASTER_RE = /\.(jpe?g|png|webp|gif|svg|avif|bmp)$/i;
/** Formats the file picker can offer but the browser canvas can't rasterize. */
const UNDECODABLE_RE = /\.(heic|heif|hif|tiff?|psd|cr2|cr3|nef|arw|dng|raw)$/i;
const FATAL = ["auth", "billing", "config", "not_found", "network"];
const baseName = (n: string) => n.replace(/\.[^.]+$/, "").toLowerCase();

export default function Workspace({ initial }: { initial: InitialData }) {
  const [assets, setAssets] = useState<AssetDTO[]>(initial.assets);
  const [providers, setProviders] = useState<ProviderStateDTO[]>(initial.providers);
  const [settings, setSettings] = useState<AppSettingsDTO>(initial.settings);
  const [selectedId, setSelectedId] = useState<string | null>(initial.assets[0]?.id ?? null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [queued, setQueued] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState<Filter>("all");
  const [modal, setModal] = useState<null | "settings" | "export" | "selftest">(null);
  const [upload, setUpload] = useState<{ total: number; done: number } | null>(null);
  const [run, setRun] = useState<{ total: number; done: number; failed: number } | null>(null);
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dragging, setDragging] = useState(false);
  const [serverInfo, setServerInfo] = useState<ServerInfoDTO | null>(null);
  const stopRef = useRef(false);
  const runningRef = useRef(false);
  const lastCheckRef = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const activeProvider = providers.find((p) => p.id === settings.activeProviderId) ?? providers[0];

  const notify = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 9000 : 5000);
  }, []);

  const replaceAsset = useCallback((a: AssetDTO) => setAssets((prev) => prev.map((x) => (x.id === a.id ? a : x))), []);
  const bump = useCallback(
    (ids: string[]) =>
      setRevisions((r) => {
        const n = { ...r };
        for (const id of ids) n[id] = (n[id] ?? 0) + 1;
        return n;
      }),
    [],
  );

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: assets.length, pending: 0, done: 0, review: 0, error: 0 };
    for (const a of assets) {
      if (a.status === "pending" || a.status === "processing") c.pending++;
      else if (a.status === "error") c.error++;
      else if (a.status === "done") {
        c.done++;
        if (needsReview(a)) c.review++;
      }
    }
    return c;
  }, [assets]);

  const visible = useMemo(() => {
    if (filter === "all") return assets;
    return assets.filter((a) =>
      filter === "pending"
        ? a.status === "pending" || a.status === "processing"
        : filter === "done"
          ? a.status === "done"
          : filter === "review"
            ? needsReview(a)
            : a.status === "error",
    );
  }, [assets, filter]);

  const selected = useMemo(() => assets.find((a) => a.id === selectedId) ?? null, [assets, selectedId]);

  // Environment diagnostics (storage writability + provider reachability). Explains the
  // two failure modes that look like "the app is broken": no internet, temporary storage.
  useEffect(() => {
    let alive = true;
    void Promise.all([
      api<{ ok: boolean; storage: "local" | "postgres"; storageDir?: string | null; ephemeral?: boolean }>("/api/health"),
      api<{ host: string | null; reachable: boolean | null }>("/api/connectivity"),
    ])
      .then(([health, connectivity]) => {
        if (!alive) return;
        setServerInfo({
          storage: { mode: health.storage, dir: health.storageDir ?? null, ephemeral: !!health.ephemeral },
          connectivity,
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if ((!selectedId || !assets.some((a) => a.id === selectedId)) && assets.length) setSelectedId(assets[0].id);
  }, [assets, selectedId]);

  const saveSettings = useCallback(
    async (patch: Partial<AppSettingsDTO>) => {
      setSettings((s) => ({ ...s, ...patch }));
      try {
        const r = await api<{ settings: AppSettingsDTO }>("/api/settings", { method: "PUT", json: patch });
        setSettings(r.settings);
      } catch (e) {
        notify(errMsg(e), "error");
      }
    },
    [notify],
  );

  /* ---------------- uploads ---------------- */
  const handleFiles = useCallback(
    async (input: FileList | File[]) => {
      const files = Array.from(input);
      if (!files.length) return;
      const companions = new Map<string, string>();
      for (const f of files) if (VECTOR_RE.test(f.name)) companions.set(baseName(f.name), f.name);
      const rasters: File[] = [];
      const skipped: { name: string; reason: string }[] = [];
      for (const f of files) {
        if (VECTOR_RE.test(f.name)) continue; // vector sources are paired by name, never uploaded directly
        const looksRaster = f.type.startsWith("image/") || RASTER_RE.test(f.name);
        const undecodable =
          UNDECODABLE_RE.test(f.name) || f.type === "image/tiff" || f.type === "image/heic" || f.type === "image/heif";
        if (!looksRaster) {
          skipped.push({ name: f.name, reason: "not a supported image (use JPEG, PNG, WebP or SVG)" });
          continue;
        }
        if (undecodable) {
          skipped.push({
            name: f.name,
            reason: /heic|heif|hif/i.test(f.name) || f.type === "image/heic" || f.type === "image/heif"
              ? "iPhone HEIC photo — convert to JPEG first"
              : "browsers can't preview this format — export as JPEG or PNG",
          });
          continue;
        }
        rasters.push(f);
      }
      const orphans = [...companions.entries()].filter(([b]) => !rasters.some((r) => baseName(r.name) === b)).map(([, n]) => n);
      if (!rasters.length) {
        notify(
          skipped.length
            ? `Nothing uploaded. ${skipped[0].name}: ${skipped[0].reason}${skipped.length > 1 ? ` (+${skipped.length - 1} more)` : ""}`
            : orphans.length
              ? "Vector source files (.eps/.ai/.pdf) can't be previewed in the browser — add the JPEG/PNG/SVG preview with the same base name."
              : "No supported images found (JPEG, PNG, WebP, SVG).",
          "error",
        );
        return;
      }
      setUpload({ total: rasters.length, done: 0 });
      const created: AssetDTO[] = [];
      let paired = 0;
      await runPool(rasters, 3, async (f) => {
        try {
          const img = await processImage(f);
          const isSvg = f.type === "image/svg+xml" || /\.svg$/i.test(f.name);
          const companion = companions.get(baseName(f.name)) ?? null;
          if (companion) paired++;
          const fd = new FormData();
          fd.append("filename", f.name);
          fd.append("width", String(img.width));
          fd.append("height", String(img.height));
          fd.append("hint", settings.defaultHint);
          if (companion || isSvg) fd.append("fileType", "vector");
          if (companion) fd.append("vectorCompanion", companion);
          fd.append("analysis", img.analysis, "analysis.jpg");
          fd.append("thumb", img.thumb, "thumb.jpg");
          const r = await api<{ asset: AssetDTO }>("/api/assets", { method: "POST", body: fd });
          created.push(r.asset);
          setAssets((prev) => [...prev, r.asset]);
        } catch (e) {
          notify(`${f.name}: ${errMsg(e)}`, "error");
        } finally {
          setUpload((u) => (u ? { ...u, done: u.done + 1 } : u));
        }
      });
      setUpload(null);
      if (created.length) {
        setSelectedId((id) => id ?? created[0].id);
        notify(`Added ${created.length} file(s)${paired ? ` · ${paired} paired with a vector source` : ""}`, "success");
      }
      if (skipped.length)
        notify(
          `Skipped ${skipped.length} file(s): ${skipped
            .slice(0, 3)
            .map((s) => `${s.name} (${s.reason})`)
            .join("; ")}${skipped.length > 3 ? " …" : ""}`,
          "error",
        );
      if (orphans.length) notify(`${orphans.length} vector file(s) had no matching preview: ${orphans.slice(0, 3).join(", ")}`, "info");
    },
    [settings.defaultHint, notify],
  );

  const loadSamples = useCallback(async () => {
    try {
      const files = await Promise.all(
        SAMPLE_IMAGES.map(async (s) => {
          const r = await fetch(`/samples/${s.file}`);
          const b = await r.blob();
          return new File([b], s.file, { type: b.type || "image/jpeg" });
        }),
      );
      await handleFiles(files);
    } catch (e) {
      notify(errMsg(e), "error");
    }
  }, [handleFiles, notify]);

  /* ---------------- generation queue ---------------- */
  const generate = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      if (runningRef.current) {
        notify("A generation run is already in progress", "info");
        return;
      }
      const prov = providers.find((p) => p.id === settings.activeProviderId);
      if (!prov?.ready) {
        notify(`${prov?.label ?? "Provider"} isn't ready: ${prov?.readyReason ?? "configure it in Settings"}`, "error");
        setModal("settings");
        return;
      }
      runningRef.current = true;
      stopRef.current = false;
      setQueued(new Set(ids));
      setRun({ total: ids.length, done: 0, failed: 0 });
      let fatal: string | null = null;
      await runPool(
        ids,
        settings.concurrency,
        async (id) => {
          setQueued((q) => {
            const n = new Set(q);
            n.delete(id);
            return n;
          });
          setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, status: "processing", error: null } : a)));
          try {
            const r = await api<{ asset: AssetDTO; errorCode?: string }>(`/api/assets/${id}/generate`, {
              method: "POST",
              json: { providerId: prov.id, platforms: settings.platforms },
            });
            replaceAsset(r.asset);
            bump([id]);
            const failed = r.asset.status === "error";
            setRun((s) => (s ? { ...s, done: s.done + 1, failed: s.failed + (failed ? 1 : 0) } : s));
            if (r.errorCode && FATAL.includes(r.errorCode)) {
              fatal = r.asset.error ?? r.errorCode;
              stopRef.current = true;
              setQueued(new Set());
            }
          } catch (e) {
            setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, status: "error", error: errMsg(e) } : a)));
            setRun((s) => (s ? { ...s, done: s.done + 1, failed: s.failed + 1 } : s));
          }
        },
        () => stopRef.current,
      );
      runningRef.current = false;
      setQueued(new Set());
      setRun(null);
      if (fatal) notify(`Stopped: ${fatal}`, "error");
      else if (stopRef.current) notify("Generation stopped", "info");
      else notify(`Finished ${ids.length} file(s)`, "success");
    },
    [providers, settings.activeProviderId, settings.concurrency, settings.platforms, notify, replaceAsset, bump],
  );

  const stop = useCallback(() => {
    stopRef.current = true;
    setQueued(new Set());
  }, []);

  /* ---------------- edits ---------------- */
  const patchOne = useCallback(
    async (id: string, body: Record<string, unknown>, remount: boolean) => {
      try {
        const r = await api<{ asset: AssetDTO }>(`/api/assets/${id}`, { method: "PATCH", json: body });
        replaceAsset(r.asset);
        if (remount) bump([id]);
      } catch (e) {
        notify(errMsg(e), "error");
      }
    },
    [replaceAsset, bump, notify],
  );

  const onHint = useCallback(
    (id: string, hint: ContentTypeHint) => {
      setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, hint } : a)));
      void patchOne(id, { hint }, false);
    },
    [patchOne],
  );
  const onFileType = useCallback((id: string, fileType: FileTypeDecision | null) => void patchOne(id, { fileType }, true), [patchOne]);
  const onSave = useCallback((id: string, result: MetadataResult) => void patchOne(id, { result }, false), [patchOne]);

  const bulkPatch = useCallback(
    async (ids: string[], body: { hint?: ContentTypeHint; fileType?: FileTypeDecision }) => {
      if (!ids.length) return;
      try {
        const r = await api<{ assets: AssetDTO[] }>("/api/assets", { method: "PATCH", json: { ids, ...body } });
        const map = new Map(r.assets.map((a) => [a.id, a]));
        setAssets((prev) => prev.map((a) => map.get(a.id) ?? a));
        if (body.fileType) bump(ids);
        notify(`Updated ${r.assets.length} file(s)`, "success");
      } catch (e) {
        notify(errMsg(e), "error");
      }
    },
    [bump, notify],
  );

  const removeAssets = useCallback(
    async (ids: string[] | "all") => {
      const n = ids === "all" ? assets.length : ids.length;
      if (!n || !window.confirm(`Delete ${n} file(s) and their metadata?`)) return;
      try {
        await api("/api/assets", { method: "DELETE", json: ids === "all" ? { all: true } : { ids } });
        const gone = ids === "all" ? null : new Set(ids);
        setAssets((prev) => (gone ? prev.filter((a) => !gone.has(a.id)) : []));
        setChecked((prev) => {
          if (!gone) return new Set();
          const next = new Set(prev);
          for (const id of gone) next.delete(id);
          return next;
        });
        setSelectedId((cur) => (cur && (!gone || gone.has(cur)) ? null : cur));
      } catch (e) {
        notify(errMsg(e), "error");
      }
    },
    [assets.length, notify],
  );

  const toggleCheck = useCallback(
    (id: string, shift: boolean) => {
      const anchor = lastCheckRef.current;
      setChecked((prev) => {
        const next = new Set(prev);
        if (shift && anchor) {
          const ids = visible.map((a) => a.id);
          const a = ids.indexOf(anchor);
          const b = ids.indexOf(id);
          if (a >= 0 && b >= 0) {
            const [s, e] = a < b ? [a, b] : [b, a];
            for (let i = s; i <= e; i++) next.add(ids[i]);
            return next;
          }
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      lastCheckRef.current = id;
    },
    [visible],
  );

  /* ---------------- window drag & drop ---------------- */
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer?.files?.length) void handleFiles(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [handleFiles]);

  const pendingIds = useMemo(() => assets.filter((a) => a.status === "pending" || a.status === "error").map((a) => a.id), [assets]);
  const checkedIds = useMemo(() => assets.filter((a) => checked.has(a.id)).map((a) => a.id), [assets, checked]);
  const allVisibleChecked = visible.length > 0 && visible.every((a) => checked.has(a.id));

  return (
    <div className="flex h-dvh flex-col bg-zinc-950 text-zinc-100">
      {/* ---------- header ---------- */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-800/80 bg-zinc-950/90 px-3 backdrop-blur sm:px-4">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-900/40">
            <IconLogo className="h-4 w-4" />
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-white">StockMeta</div>
            <div className="hidden text-[11px] text-zinc-500 sm:block">Microstock metadata generator</div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg bg-zinc-900 pl-2.5 ring-1 ring-inset ring-zinc-800" title={activeProvider?.ready ? "Ready" : activeProvider?.readyReason ?? ""}>
            <span className={cx("h-2 w-2 shrink-0 rounded-full", activeProvider?.ready ? "bg-emerald-400" : "bg-amber-400")} />
            <select
              aria-label="AI provider"
              value={settings.activeProviderId}
              onChange={(e) => void saveSettings({ activeProviderId: e.target.value })}
              className="h-9 max-w-[150px] bg-transparent pr-2 text-sm text-zinc-100 outline-none sm:max-w-none"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.isDefault ? " (default)" : ""}
                  {p.ready ? "" : " — needs setup"}
                </option>
              ))}
            </select>
          </div>
          <div className="hidden items-center gap-1 xl:flex">
            {PLATFORM_IDS.map((p) => {
              const on = settings.platforms.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    const next = on ? settings.platforms.filter((x) => x !== p) : [...settings.platforms, p];
                    if (!next.length) return notify("Keep at least one platform", "info");
                    void saveSettings({ platforms: PLATFORM_IDS.filter((x) => next.includes(x)) });
                  }}
                  className={cx(
                    "rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset transition",
                    on ? "bg-violet-500/15 text-violet-200 ring-violet-500/40" : "text-zinc-500 ring-zinc-800 hover:text-zinc-300",
                  )}
                  title={`${on ? "Disable" : "Enable"} ${PLATFORM_SPECS[p].label}`}
                >
                  {PLATFORM_SPECS[p].short}
                </button>
              );
            })}
          </div>
          <Button variant="ghost" onClick={() => setModal("selftest")} className="hidden md:inline-flex" title="Acceptance test">
            <IconFlask />
            <span className="hidden lg:inline">Test</span>
          </Button>
          <Button variant="secondary" onClick={() => setModal("settings")} title="Settings">
            <IconSettings />
            <span className="hidden sm:inline">Settings</span>
          </Button>
          <Button variant="primary" onClick={() => setModal("export")} disabled={!counts.done} title="Export CSV">
            <IconDownload />
            <span className="hidden sm:inline">Export CSV</span>
          </Button>
        </div>
      </header>

      {serverInfo && <ServerWarnings info={serverInfo} />}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ---------- sidebar ---------- */}
        <aside className="flex h-[46vh] w-full shrink-0 flex-col border-b border-zinc-800/80 lg:h-auto lg:w-[400px] lg:border-b-0 lg:border-r">
          <div className="space-y-3 border-b border-zinc-800/80 p-4">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="group flex w-full items-center gap-3 rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 px-4 py-3 text-left transition hover:border-violet-500/60 hover:bg-violet-500/5"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-violet-500/15 text-violet-300">
                {upload ? <Spinner /> : <IconUpload />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-zinc-100">{upload ? `Uploading ${upload.done}/${upload.total}…` : "Add images"}</span>
                <span className="block truncate text-xs text-zinc-500">Drop JPEG/PNG/WebP/SVG previews · .eps/.ai pair by name</span>
              </span>
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="image/*,.eps,.ai,.svg,.pdf"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) void handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Content type for new uploads</div>
              <Segmented size="sm" stretch value={settings.defaultHint} options={HINT_OPTIONS} onChange={(v) => void saveSettings({ defaultHint: v })} />
            </div>
          </div>

          <div className="space-y-2 border-b border-zinc-800/80 p-4">
            {run ? (
              <div>
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span className="flex items-center gap-2">
                    <Spinner className="h-3.5 w-3.5 text-violet-300" />
                    {run.done}/{run.total} done{run.failed ? ` · ${run.failed} failed` : ""}
                  </span>
                  <Button size="xs" variant="subtle" onClick={stop}>
                    <IconStop className="h-3 w-3" />
                    Stop
                  </Button>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all" style={{ width: `${(run.done / run.total) * 100}%` }} />
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button variant="primary" className="flex-1" onClick={() => void generate(pendingIds)} disabled={!pendingIds.length}>
                  <IconSparkles />
                  Generate{pendingIds.length ? ` (${pendingIds.length})` : ""}
                </Button>
                {checkedIds.length > 0 && (
                  <Button onClick={() => void generate(checkedIds)} title="Generate / regenerate the checked files">
                    Checked ({checkedIds.length})
                  </Button>
                )}
              </div>
            )}
            <div className="truncate text-[11px] text-zinc-500">
              via <span className="text-zinc-300">{activeProvider?.label}</span> · {activeProvider?.model || "—"} · {settings.concurrency} parallel ·{" "}
              {settings.platforms.map((p) => PLATFORM_SPECS[p].short).join(", ")}
            </div>
          </div>

          <div className="scroll-thin flex items-center gap-1 overflow-x-auto border-b border-zinc-800/80 px-3 py-2">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={cx(
                  "flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium transition",
                  filter === f.id ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-zinc-200",
                )}
              >
                {f.label}
                <span className="tabular-nums text-zinc-500">{counts[f.id]}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 border-b border-zinc-800/80 px-3 py-2 text-xs">
            <input
              type="checkbox"
              checked={allVisibleChecked}
              onChange={() => setChecked(allVisibleChecked ? new Set() : new Set(visible.map((a) => a.id)))}
              className="h-3.5 w-3.5 accent-violet-500"
              aria-label="Select all shown"
            />
            {checked.size ? (
              <>
                <span className="text-zinc-300">{checked.size} checked</span>
                <select
                  value=""
                  onChange={(e) => {
                    const v = e.target.value as ContentTypeHint | "";
                    if (v) void bulkPatch(checkedIds, { hint: v });
                  }}
                  className="rounded-md border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-xs text-zinc-300"
                  aria-label="Set content type for checked files"
                >
                  <option value="">Set type…</option>
                  {HINT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => void removeAssets(checkedIds)} className="ml-auto text-rose-300 hover:text-rose-200">
                  Delete
                </button>
              </>
            ) : (
              <>
                <span className="text-zinc-500">{visible.length} shown</span>
                {assets.length > 0 && (
                  <button type="button" onClick={() => void removeAssets("all")} className="ml-auto text-zinc-500 hover:text-rose-300">
                    Clear all
                  </button>
                )}
              </>
            )}
          </div>

          <div className="min-h-0 flex-1">
            {visible.length ? (
              <AssetList assets={visible} selectedId={selectedId} checked={checked} queued={queued} onSelect={setSelectedId} onToggleCheck={toggleCheck} />
            ) : (
              <div className="p-8 text-center text-sm text-zinc-500">{assets.length ? "Nothing in this filter." : "No files yet — add images to begin."}</div>
            )}
          </div>
        </aside>

        {/* ---------- main ---------- */}
        <main className="scroll-thin min-w-0 flex-1 overflow-y-auto">
          {selected ? (
            <AssetDetail
              key={`${selected.id}:${revisions[selected.id] ?? 0}`}
              asset={selected}
              queued={queued.has(selected.id)}
              onGenerate={(id) => void generate([id])}
              onHint={onHint}
              onFileType={onFileType}
              onSave={onSave}
              onDelete={(id) => void removeAssets([id])}
            />
          ) : (
            <EmptyState
              providerLabel={activeProvider?.label ?? "DeepSeek"}
              providerReady={!!activeProvider?.ready}
              onAdd={() => fileInput.current?.click()}
              onSamples={() => void loadSamples()}
              onTest={() => setModal("selftest")}
              onSettings={() => setModal("settings")}
            />
          )}
        </main>
      </div>

      <SettingsModal
        open={modal === "settings"}
        onClose={() => setModal(null)}
        providers={providers}
        settings={settings}
        serverInfo={serverInfo}
        onProvider={(p) => setProviders((prev) => prev.map((x) => (x.id === p.id ? p : x)))}
        onSettings={(patch) => void saveSettings(patch)}
        onOpenSelfTest={() => setModal("selftest")}
      />
      <ExportModal
        open={modal === "export"}
        onClose={() => setModal(null)}
        assets={assets}
        checked={checked}
        platforms={settings.platforms}
        onFileTypes={(ids, t) => void bulkPatch(ids, { fileType: t })}
      />
      <SelfTestModal open={modal === "selftest"} onClose={() => setModal(null)} provider={activeProvider} onOpenSettings={() => setModal("settings")} />

      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur",
              t.tone === "error"
                ? "border-rose-500/30 bg-rose-950/85 text-rose-100"
                : t.tone === "success"
                  ? "border-emerald-500/30 bg-emerald-950/85 text-emerald-100"
                  : "border-zinc-700 bg-zinc-900/90 text-zinc-100",
            )}
          >
            {t.text}
          </div>
        ))}
      </div>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[70] grid place-items-center bg-violet-950/40 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-violet-400/70 bg-zinc-950/85 px-10 py-8 text-center">
            <IconUpload className="mx-auto h-8 w-8 text-violet-300" />
            <div className="mt-3 text-lg font-semibold text-white">Drop to add</div>
            <div className="text-sm text-zinc-400">JPEG / PNG / WebP / SVG previews · .eps/.ai pair by filename</div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({
  providerLabel,
  providerReady,
  onAdd,
  onSamples,
  onTest,
  onSettings,
}: {
  providerLabel: string;
  providerReady: boolean;
  onAdd: () => void;
  onSamples: () => void;
  onTest: () => void;
  onSettings: () => void;
}) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="relative overflow-hidden rounded-3xl border border-zinc-800 bg-gradient-to-b from-zinc-900/90 to-zinc-950 p-7 sm:p-10">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-10 h-72 w-72 rounded-full bg-fuchsia-600/10 blur-3xl" />
        <div className="relative">
          <div className="flex flex-wrap gap-2">
            <Badge tone="violet">DeepSeek is the default provider</Badge>
            <Badge tone={providerReady ? "emerald" : "amber"}>
              {providerLabel} · {providerReady ? "ready" : "needs an API key"}
            </Badge>
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Metadata that matches the product type.</h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-zinc-400">
            A single background and a template pack are different products on every stock platform, and buyers search for them differently. Each upload is
            classified first, then written with the convention that top-ranking listings of that type actually use.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button variant="primary" onClick={onAdd}>
              <IconUpload />
              Add images
            </Button>
            <Button onClick={onSamples}>
              <IconImage />
              Load the 2 sample images
            </Button>
            <Button variant="ghost" onClick={providerReady ? onTest : onSettings}>
              <IconFlask />
              {providerReady ? "Run acceptance test" : "Add API key"}
            </Button>
          </div>
        </div>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <ConventionCard
          tone="sky"
          icon={<IconImage className="h-4 w-4" />}
          title="Single background"
          rules="Rules A–G"
          points={[
            "Title literally describes ONE visual",
            "Subject + colors + style — ≤70 chars on Adobe & Freepik",
            "Color words + use-case keywords (background, wallpaper, banner…)",
            "Category by subject — e.g. Backgrounds/Textures",
          ]}
          example="Navy blue and violet gradient background with soft pink glow"
        />
        <ConventionCard
          tone="fuchsia"
          icon={<IconLayers className="h-4 w-4" />}
          title="Template / design pack"
          rules="Rules A–F + H–K"
          points={[
            "Title lists what the SET contains: 2–4 distinct elements + style + template kind",
            "Design-purpose keywords: template, poster, layout, cover, flier, booklet…",
            "“Replaceable text” — never “editable text” (Adobe vector guidance)",
            "Category: Graphic Resources · vector file type confirmed before export",
          ]}
          example="Blue gradient poster templates set with glowing lines and soft circles"
        />
      </div>
    </div>
  );
}

function ConventionCard({ tone, icon, title, rules, points, example }: { tone: Tone; icon: ReactNode; title: string; rules: string; points: string[]; example: string }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="flex items-center justify-between gap-2">
        <Badge tone={tone}>
          {icon}
          {title}
        </Badge>
        <span className="font-mono text-[11px] text-zinc-500">{rules}</span>
      </div>
      <ul className="mt-4 space-y-2 text-[13px] text-zinc-300">
        {points.map((p) => (
          <li key={p} className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-zinc-500" />
            {p}
          </li>
        ))}
      </ul>
      <div className="mt-4 rounded-lg bg-black/30 px-3 py-2 text-xs text-zinc-400 ring-1 ring-zinc-800">
        <span className="text-zinc-500">e.g. </span>“{example}”
      </div>
    </div>
  );
}
