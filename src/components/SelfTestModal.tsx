"use client";

import { useState } from "react";
import { SAMPLE_IMAGES, type SampleImage, type SelfTestCase, type SelfTestReport } from "@/lib/acceptance";
import type { ProviderStateDTO } from "@/lib/providers/registry";
import { api, errMsg } from "@/lib/client/api";
import { Badge, Button, Modal, Spinner, cx } from "./ui";
import { IconAlert, IconCheck, IconFlask, IconX } from "./icons";

interface Props {
  open: boolean;
  onClose: () => void;
  provider: ProviderStateDTO | undefined;
  onOpenSettings: () => void;
}

export default function SelfTestModal({ open, onClose, provider, onOpenSettings }: Props) {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<SelfTestReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setReport(await api<SelfTestReport>("/api/selftest", { method: "POST", json: { providerId: provider?.id } }));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-5xl"
      title="Acceptance test — content-type conventions"
      subtitle="Sends the two bundled genuine images to the selected provider in auto-detect mode (with neutral filenames, so the name can't leak the answer) and scores the raw model output and the validated output separately — auto-fixes can't hide a model miss."
      footer={
        <>
          <span className="mr-auto text-xs text-zinc-500">{provider ? `${provider.label} · ${provider.model || "no model"}` : ""}</span>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={run} disabled={running || !provider?.ready}>
            {running ? <Spinner /> : <IconFlask />}
            {running ? "Running…" : report ? "Run again" : "Run test"}
          </Button>
        </>
      }
    >
      {!provider?.ready && (
        <div className="mb-4 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200 ring-1 ring-amber-500/30">
          {provider?.label ?? "The selected provider"} isn&apos;t configured yet ({provider?.readyReason ?? "missing settings"}).{" "}
          <button type="button" className="underline underline-offset-2" onClick={onOpenSettings}>
            Open settings
          </button>{" "}
          and add the API key first.
        </div>
      )}
      {error && <div className="mb-4 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-200 ring-1 ring-rose-500/30">{error}</div>}
      {report && (
        <div
          className={cx(
            "mb-4 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium ring-1",
            report.passed ? "bg-emerald-500/10 text-emerald-200 ring-emerald-500/30" : "bg-rose-500/10 text-rose-200 ring-rose-500/30",
          )}
        >
          {report.passed ? <IconCheck /> : <IconAlert />}
          {report.passed ? "PASS" : "FAIL"} — {report.providerLabel} · {report.model} · {new Date(report.ranAt).toLocaleTimeString()}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {SAMPLE_IMAGES.map((s) => (
          <SampleCard key={s.id} sample={s} c={report?.cases.find((x) => x.id === s.id)} running={running} />
        ))}
      </div>
    </Modal>
  );
}

function Mark({ pass }: { pass: boolean | undefined }) {
  if (pass === undefined) return <span className="text-zinc-600">—</span>;
  return pass ? <IconCheck className="mx-auto h-3.5 w-3.5 text-emerald-400" /> : <IconX className="mx-auto h-3.5 w-3.5 text-rose-400" />;
}

function SampleCard({ sample, c, running }: { sample: SampleImage; c: SelfTestCase | undefined; running: boolean }) {
  const P = c?.result?.platforms;
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/samples/${sample.file}`} alt={sample.label} className="h-40 w-full object-cover" />
        {running && (
          <div className="absolute inset-0 grid place-items-center bg-black/50">
            <Spinner className="h-5 w-5 text-violet-300" />
          </div>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-medium text-zinc-100">{sample.label}</div>
            <div className="text-xs text-zinc-500">{sample.description}</div>
          </div>
          {c && <Badge tone={c.ok ? "emerald" : "rose"}>{c.ok ? "PASS" : "FAIL"}</Badge>}
        </div>
        <div className="mt-2 text-xs text-zinc-400">
          Expected <span className="font-mono text-zinc-200">{sample.expected}</span>
          {c && (
            <>
              {" "}
              · model said{" "}
              <span className={cx("font-mono", c.modelContentType === sample.expected ? "text-emerald-300" : "text-rose-300")}>
                {c.modelContentType ?? "—"}
              </span>
            </>
          )}
        </div>
        {c?.error && <p className="mt-3 text-xs text-rose-300">{c.error}</p>}
        {c && c.finalChecks.length > 0 && (
          <table className="mt-3 w-full text-xs">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="py-1 font-medium">Check</th>
                <th className="w-12 py-1 text-center font-medium" title="Raw model output">
                  Raw
                </th>
                <th className="w-12 py-1 text-center font-medium" title="After the validation layer">
                  Final
                </th>
              </tr>
            </thead>
            <tbody>
              {c.finalChecks.map((fc) => {
                const rc = c.rawChecks.find((r) => r.id === fc.id);
                return (
                  <tr key={fc.id} className="border-t border-zinc-800/70 align-top">
                    <td className="py-1.5 pr-2">
                      <div className="text-zinc-200">
                        {fc.label}
                        {!fc.critical && <span className="ml-1 text-zinc-600">(info)</span>}
                      </div>
                      <div className="break-words text-zinc-500">{fc.detail}</div>
                    </td>
                    <td className="py-1.5 text-center">
                      <Mark pass={rc?.pass} />
                    </td>
                    <td className="py-1.5 text-center">
                      <Mark pass={fc.pass} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {P && (
          <div className="mt-3 space-y-1.5 rounded-lg bg-black/30 p-3 text-xs">
            {P.adobe && (
              <div>
                <span className="text-zinc-500">Adobe title · </span>
                <span className="text-zinc-100">{P.adobe.title}</span>
              </div>
            )}
            {P.shutterstock && (
              <div>
                <span className="text-zinc-500">Shutterstock · </span>
                <span className="text-zinc-300">{P.shutterstock.description}</span>
              </div>
            )}
            {P.adobe && (
              <div className="text-zinc-400">
                <span className="text-zinc-500">First 12 keywords · </span>
                {P.adobe.keywords.slice(0, 12).join(", ")}
              </div>
            )}
            <div>
              <span className="text-zinc-500">Category · </span>
              <span className="text-zinc-200">{c?.result?.category_suggestion}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
