"use client";

import { useState, type ClipboardEvent } from "react";
import { normalizeKeyword } from "@/lib/validation";
import { IconX } from "./icons";
import { cx } from "./ui";

interface Props {
  keywords: string[];
  max: number;
  min?: number;
  /** How many leading keywords carry extra weight (Adobe: first 10). */
  weighted?: number;
  onChange: (next: string[]) => void;
}

export default function KeywordEditor({ keywords, max, min = 5, weighted = 10, onChange }: Props) {
  const [input, setInput] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const add = (raw: string) => {
    const parts = raw.split(/[,;\n]/).map(normalizeKeyword).filter(Boolean);
    setInput("");
    if (!parts.length) return;
    const next = [...keywords];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    onChange(next);
  };
  const remove = (i: number) => onChange(keywords.filter((_, j) => j !== i));
  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...keywords];
    const [k] = next.splice(from, 1);
    next.splice(to, 0, k);
    onChange(next);
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (/[,;\n]/.test(text)) {
      e.preventDefault();
      add(text);
    }
  };

  const countTone = keywords.length > max ? "text-rose-400" : keywords.length < min ? "text-amber-400" : "text-zinc-500";

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-2 focus-within:border-violet-500/60">
        {keywords.map((k, i) => (
          <span
            key={`${k}-${i}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", k);
              setDragIndex(i);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setOverIndex(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null) move(dragIndex, i);
              setDragIndex(null);
              setOverIndex(null);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
            className={cx(
              "group inline-flex cursor-grab items-center gap-1 rounded-md py-0.5 pl-1.5 pr-0.5 text-[12px] ring-1 ring-inset active:cursor-grabbing",
              i < weighted ? "bg-violet-500/10 text-violet-100 ring-violet-500/30" : "bg-zinc-800/80 text-zinc-200 ring-zinc-700",
              i >= max && "bg-rose-500/10 text-rose-200 ring-rose-500/40",
              overIndex === i && dragIndex !== null && dragIndex !== i && "ring-2 ring-violet-400",
            )}
          >
            <span className="tabular-nums text-[10px] text-zinc-500">{i + 1}</span>
            {k}
            <button
              type="button"
              onClick={() => remove(i)}
              className="rounded p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-white"
              aria-label={`Remove ${k}`}
            >
              <IconX className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(input);
            }
          }}
          onPaste={onPaste}
          onBlur={() => input.trim() && add(input)}
          placeholder="Add keyword…"
          className="min-w-[120px] flex-1 bg-transparent px-1 py-0.5 text-[12px] text-zinc-100 outline-none placeholder:text-zinc-600"
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-500">
        <span>Drag to reorder · the first {weighted} carry the most weight</span>
        <span className={cx("tabular-nums", countTone)}>
          {keywords.length}/{max}
        </span>
      </div>
    </div>
  );
}
