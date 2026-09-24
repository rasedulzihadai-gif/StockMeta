"use client";

import type { ServerInfoDTO } from "@/lib/types";
import { IconAlert } from "./icons";

/**
 * Environment warnings shown when the app can't do its job properly from where it's
 * running: no internet (provider calls fail) or temporary storage (data lost on restart).
 * Both look like "the app is broken / my key is wrong" without an explicit explanation.
 */
export function ServerWarnings({ info, compact = false }: { info: ServerInfoDTO; compact?: boolean }) {
  const warnings: string[] = [];
  if (info.connectivity.host && info.connectivity.reachable === false) {
    warnings.push(
      `This server can't reach ${info.connectivity.host}, so Test connection and Generate will fail here with a network error — that is NOT an API key problem. ` +
        "Hosted preview sandboxes usually have no outbound internet: run the app on your own machine (npm install && npm run dev) or somewhere the provider API is reachable.",
    );
  }
  if (info.storage.mode === "local" && info.storage.ephemeral) {
    warnings.push(
      `Storage had to fall back to a temporary folder (${info.storage.dir}) because the app's filesystem is read-only — uploads and API keys are lost when it restarts. ` +
        "Set DATABASE_URL (PostgreSQL) for durable storage.",
    );
  }
  if (!warnings.length) return null;
  return (
    <div className={compact ? "space-y-2" : "space-y-2 border-b border-amber-500/20 bg-amber-500/[0.06] px-4 py-2.5"}>
      {warnings.map((w, i) => (
        <div
          key={i}
          className="flex items-start gap-2 text-xs leading-relaxed text-amber-200"
        >
          <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{w}</span>
        </div>
      ))}
    </div>
  );
}
