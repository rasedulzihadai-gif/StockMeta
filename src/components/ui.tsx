"use client";

import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { IconX } from "./icons";

export function cx(...c: Array<string | false | null | undefined>): string {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-violet-600 text-white hover:bg-violet-500 shadow-[0_0_0_1px_rgba(139,92,246,0.45),0_8px_24px_-10px_rgba(139,92,246,0.7)]",
  secondary: "bg-zinc-800/80 text-zinc-100 hover:bg-zinc-700/80 ring-1 ring-inset ring-zinc-700",
  ghost: "text-zinc-300 hover:bg-zinc-800/70 hover:text-white",
  danger: "bg-rose-600/90 text-white hover:bg-rose-500",
  subtle: "bg-zinc-900 text-zinc-300 ring-1 ring-inset ring-zinc-800 hover:bg-zinc-800 hover:text-white",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "xs" | "sm" | "md" }) {
  return (
    <button
      type={type}
      {...props}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/70 disabled:cursor-not-allowed disabled:opacity-45",
        size === "md" ? "h-9 px-3.5 text-sm" : size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-6 px-2 text-xs",
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export type Tone = "zinc" | "violet" | "emerald" | "amber" | "rose" | "sky" | "fuchsia";
const TONES: Record<Tone, string> = {
  zinc: "bg-zinc-800/80 text-zinc-300 ring-zinc-700",
  violet: "bg-violet-500/15 text-violet-200 ring-violet-500/30",
  emerald: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  amber: "bg-amber-500/15 text-amber-200 ring-amber-500/30",
  rose: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  sky: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  fuchsia: "bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-500/30",
};

export function Badge({ tone = "zinc", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  stretch = false,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  stretch?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      className={cx("inline-flex max-w-full flex-wrap rounded-lg bg-zinc-900 p-0.5 ring-1 ring-inset ring-zinc-800", stretch && "flex w-full flex-nowrap", className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-md font-medium transition-colors",
            stretch ? "min-w-0 flex-auto whitespace-normal leading-tight" : "whitespace-nowrap",
            size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-[13px]",
            value === o.value ? "bg-zinc-700 text-white shadow" : "text-zinc-400 hover:text-zinc-200",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = "max-w-3xl",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" className={cx("relative w-full rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl", width)}>
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white">{title}</h2>
            {subtitle && <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white" aria-label="Close">
            <IconX className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-800 px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx("inline-flex cursor-pointer select-none items-center gap-2 text-sm text-zinc-300", disabled && "cursor-not-allowed opacity-50")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx("relative h-5 w-9 rounded-full transition-colors", checked ? "bg-violet-600" : "bg-zinc-700")}
      >
        <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </button>
      {label}
    </label>
  );
}

export function CharCounter({ length, max, hardMax }: { length: number; max: number; hardMax?: number }) {
  const over = length > max;
  const overHard = hardMax !== undefined && length > hardMax;
  return (
    <span className={cx("tabular-nums text-[11px]", overHard ? "text-rose-400" : over ? "text-amber-400" : "text-zinc-500")}>
      {length}/{max}
      {hardMax && hardMax !== max ? <span className="text-zinc-600"> · hard {hardMax}</span> : null}
    </span>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={cx("animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export const inputCls =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/20";
