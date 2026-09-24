"use client";

import { useMemo, useState } from "react";
import { CSV_FORMATS, DEFAULT_EXPORT_OPTIONS, buildCsv, type ExportOptions, type QuoteChar } from "@/lib/csv";
import { PLATFORM_SPECS } from "@/lib/platforms";
import { PLATFORM_IDS, needsFileTypeConfirmation, type AssetDTO, type FileTypeDecision, type PlatformId } from "@/lib/types";
import { Badge, Button, Modal, Segmented, Toggle, cx, inputCls } from "./ui";
import { IconAlert, IconDownload } from "./icons";

interface Props {
  open: boolean;
  onClose: () => void;
  assets: AssetDTO[];
  checked: Set<string>;
  platforms: PlatformId[];
  onFileTypes: (ids: string[], t: FileTypeDecision) => void;
}

export default function ExportModal(props: Props) {
  if (!props.open) return null;
  return <ExportModalBody {...props} />;
}

function ExportModalBody({ onClose, assets, checked, platforms, onFileTypes }: Props) {
  const [platform, setPlatform] = useState<PlatformId>(platforms[0] ?? "adobe");
  const [scope, setScope] = useState<"all" | "checked">(checked.size ? "checked" : "all");
  const [opts, setOpts] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);
  const [skipConfirm, setSkipConfirm] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);

  const generated = useMemo(() => assets.filter((a) => a.result), [assets]);
  const scoped = useMemo(() => generated.filter((a) => scope === "all" || checked.has(a.id)), [generated, scope, checked]);
  const unconfirmed = useMemo(() => scoped.filter(needsFileTypeConfirmation), [scoped]);
  const out = useMemo(() => buildCsv(platform, scoped, opts), [platform, scoped, opts]);
  const blocked = unconfirmed.length > 0 && !skipConfirm;
  const preview = out.content.split("\n").slice(0, 6).join("\n");

  const download = () => {
    const blob = new Blob([out.content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = out.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-4xl"
      title="Export CSV"
      subtitle="Each platform gets its own delimiter/quoting convention. Rows are built from the validated metadata, including your edits."
      footer={
        <>
          <span className="mr-auto text-xs text-zinc-500">
            {out.rows} row(s){out.skipped.length ? ` · ${out.skipped.length} skipped` : ""} · {out.filename}
          </span>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={download} disabled={blocked || out.rows === 0}>
            <IconDownload />
            Download {PLATFORM_SPECS[platform].short} CSV
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={platform} onChange={setPlatform} options={PLATFORM_IDS.map((p) => ({ value: p, label: PLATFORM_SPECS[p].label }))} />
        <Segmented
          size="sm"
          value={scope}
          onChange={setScope}
          options={[
            { value: "all", label: `All generated (${generated.length})` },
            { value: "checked", label: `Checked (${generated.filter((a) => checked.has(a.id)).length})` },
          ]}
        />
      </div>

      <p className="mt-3 rounded-lg bg-zinc-900/70 px-3 py-2 text-xs text-zinc-400 ring-1 ring-zinc-800">
        <span className="font-medium text-zinc-200">{PLATFORM_SPECS[platform].label}:</span> {CSV_FORMATS[platform].note}
      </p>

      {unconfirmed.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-100">
              <IconAlert className="h-4 w-4" />
              Confirm the actual file type — {unconfirmed.length} file(s) look like vector art
            </div>
            <div className="flex gap-2">
              <Button size="xs" variant="subtle" onClick={() => onFileTypes(unconfirmed.map((a) => a.id), "vector")}>
                All vector
              </Button>
              <Button size="xs" variant="subtle" onClick={() => onFileTypes(unconfirmed.map((a) => a.id), "raster")}>
                All raster
              </Button>
            </div>
          </div>
          <p className="mt-1 text-xs text-amber-100/70">
            A JPEG preview can&apos;t prove the real format. Raster files get vector wording stripped; vector files are marked as illustrations.
          </p>
          <ul className="scroll-thin mt-3 max-h-48 space-y-1.5 overflow-y-auto pr-1">
            {unconfirmed.map((a) => (
              <li key={a.id} className="flex items-center gap-2 text-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/assets/${a.id}/thumb`} alt="" className="h-7 w-7 rounded object-cover" />
                <span className="min-w-0 flex-1 truncate text-zinc-300">{a.filename}</span>
                <Button size="xs" variant="subtle" onClick={() => onFileTypes([a.id], "vector")}>
                  Vector (AI/EPS)
                </Button>
                <Button size="xs" variant="subtle" onClick={() => onFileTypes([a.id], "raster")}>
                  Raster (JPEG)
                </Button>
              </li>
            ))}
          </ul>
          <label className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
            <input type="checkbox" checked={skipConfirm} onChange={(e) => setSkipConfirm(e.target.checked)} className="accent-violet-500" />
            Export anyway without confirming
          </label>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        {platform === "adobe" && (
          <Toggle checked={opts.adobeCapFilenames} onChange={(v) => setOpts({ ...opts, adobeCapFilenames: v })} label="Cap filenames at 30 characters" />
        )}
        <Toggle
          checked={opts.useVectorSourceName}
          onChange={(v) => setOpts({ ...opts, useVectorSourceName: v })}
          label="Use paired .eps/.ai name for confirmed vectors"
        />
        {platform === "freepik" && (
          <>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              Quote
              <select
                value={opts.freepikQuote}
                onChange={(e) => setOpts({ ...opts, freepikQuote: e.target.value as QuoteChar })}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs"
              >
                <option value="'">&apos; single (convention)</option>
                <option value={'"'}>&quot; double</option>
                <option value="">none</option>
              </select>
            </label>
            <label className="flex min-w-[220px] flex-1 items-center gap-2 text-sm text-zinc-300">
              AI model
              <input
                value={opts.freepikModel}
                onChange={(e) => setOpts({ ...opts, freepikModel: e.target.value })}
                placeholder="only for AI-generated files"
                className={cx(inputCls, "py-1 text-xs")}
              />
            </label>
          </>
        )}
      </div>

      {out.warnings.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {out.warnings.map((w, i) => (
            <li key={i} className="flex gap-2 rounded-lg bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-100/90 ring-1 ring-amber-500/20">
              <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
              {w}
            </li>
          ))}
        </ul>
      )}

      {out.renamed.length > 0 && (
        <details className="mt-3 text-xs text-zinc-400">
          <summary className="cursor-pointer text-zinc-300">Filename changes ({out.renamed.length})</summary>
          <ul className="mt-2 space-y-0.5 font-mono">
            {out.renamed.slice(0, 50).map((r) => (
              <li key={r.from}>
                {r.from} → <span className="text-zinc-200">{r.to}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {out.skipped.length > 0 && (
        <div className="mt-3 text-xs">
          <button type="button" className="text-zinc-400 underline-offset-2 hover:underline" onClick={() => setShowSkipped(!showSkipped)}>
            {showSkipped ? "Hide" : "Show"} {out.skipped.length} skipped file(s)
          </button>
          {showSkipped && (
            <ul className="mt-2 space-y-0.5 text-zinc-500">
              {out.skipped.slice(0, 100).map((s, i) => (
                <li key={i}>
                  {s.filename} — {s.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          <span>Preview</span>
          <Badge>{CSV_FORMATS[platform].delimiter === ";" ? "semicolon" : "comma"}-delimited</Badge>
        </div>
        <pre className="scroll-thin max-h-56 overflow-auto rounded-xl border border-zinc-800 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
          {preview}
        </pre>
      </div>
    </Modal>
  );
}
