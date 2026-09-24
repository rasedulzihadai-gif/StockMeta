"use client";

import { memo, useEffect, useRef, type KeyboardEvent } from "react";
import { useVirtualList } from "@/hooks/useVirtualList";
import { errorCount, needsFileTypeConfirmation, needsReview, type AssetDTO } from "@/lib/types";
import { Badge, Spinner, cx } from "./ui";

export const ROW_HEIGHT = 68;

interface Props {
  assets: AssetDTO[];
  selectedId: string | null;
  checked: Set<string>;
  queued: Set<string>;
  onSelect: (id: string) => void;
  onToggleCheck: (id: string, shift: boolean) => void;
}

export default function AssetList({ assets, selectedId, checked, queued, onSelect, onToggleCheck }: Props) {
  const { ref, start, end, totalHeight, scrollToIndex } = useVirtualList(assets.length, ROW_HEIGHT, 8);
  const lastSelected = useRef<string | null>(null);

  // Keep the selection in view when it changes (not on every status update).
  useEffect(() => {
    if (!selectedId || selectedId === lastSelected.current) return;
    lastSelected.current = selectedId;
    const i = assets.findIndex((a) => a.id === selectedId);
    if (i >= 0) scrollToIndex(i);
  }, [selectedId, assets, scrollToIndex]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = assets.findIndex((a) => a.id === selectedId);
    const n = e.key === "ArrowDown" ? Math.min(assets.length - 1, i + 1) : Math.max(0, i - 1);
    if (assets[n]) onSelect(assets[n].id);
  };

  const rows = [];
  for (let i = start; i < end; i++) {
    const a = assets[i];
    rows.push(
      <Row
        key={a.id}
        asset={a}
        top={i * ROW_HEIGHT}
        selected={a.id === selectedId}
        checked={checked.has(a.id)}
        queued={queued.has(a.id)}
        onSelect={onSelect}
        onToggleCheck={onToggleCheck}
      />,
    );
  }

  return (
    <div
      ref={ref}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="scroll-thin relative h-full overflow-y-auto outline-none"
      aria-label="Uploaded files"
    >
      <div style={{ height: totalHeight, position: "relative" }}>{rows}</div>
    </div>
  );
}

const Row = memo(function Row({
  asset,
  top,
  selected,
  checked,
  queued,
  onSelect,
  onToggleCheck,
}: {
  asset: AssetDTO;
  top: number;
  selected: boolean;
  checked: boolean;
  queued: boolean;
  onSelect: (id: string) => void;
  onToggleCheck: (id: string, shift: boolean) => void;
}) {
  const errs = errorCount(asset);
  const review = needsReview(asset);
  const ct = asset.result?.content_type;
  return (
    <div
      style={{ top, height: ROW_HEIGHT }}
      onClick={() => onSelect(asset.id)}
      className={cx(
        "absolute inset-x-0 flex cursor-pointer items-center gap-3 border-b border-zinc-900 px-3 transition-colors",
        selected ? "bg-violet-500/[0.12] shadow-[inset_2px_0_0_0_rgb(139,92,246)]" : "hover:bg-zinc-900/70",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        readOnly
        onClick={(e) => {
          e.stopPropagation();
          onToggleCheck(asset.id, e.shiftKey);
        }}
        className="h-3.5 w-3.5 shrink-0 accent-violet-500"
        aria-label={`Select ${asset.filename}`}
      />
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-zinc-800 ring-1 ring-zinc-800">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/assets/${asset.id}/thumb`} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        {asset.status === "processing" && (
          <div className="absolute inset-0 grid place-items-center bg-black/55">
            <Spinner className="h-4 w-4 text-violet-300" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-zinc-100" title={asset.filename}>
          {asset.filename}
        </div>
        <div className="mt-1 flex items-center gap-1.5 overflow-hidden">
          {asset.status === "processing" ? (
            <Badge tone="violet">Generating</Badge>
          ) : queued ? (
            <Badge tone="violet">Queued</Badge>
          ) : asset.status === "error" ? (
            <Badge tone="rose">Error</Badge>
          ) : asset.status === "done" ? (
            review ? <Badge tone="amber">Review</Badge> : <Badge tone="emerald">Done</Badge>
          ) : (
            <Badge>Pending</Badge>
          )}
          {ct ? (
            <Badge tone={ct === "template_pack" ? "fuchsia" : "sky"}>{ct === "template_pack" ? "Template pack" : "Single"}</Badge>
          ) : asset.hint !== "auto" ? (
            <Badge tone="zinc">{asset.hint === "template_pack" ? "Hint: template" : "Hint: single"}</Badge>
          ) : null}
          {needsFileTypeConfirmation(asset) && <Badge tone="amber">File type?</Badge>}
          {errs > 0 && <span className="text-[11px] text-rose-300">{errs} err</span>}
        </div>
      </div>
    </div>
  );
});
