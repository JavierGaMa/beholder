import { useState } from "react";
import clsx from "clsx";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  RefreshCw,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { invoke } from "../../lib/tauri";
import { useTraffic } from "../../store/traffic";
import { Badge, Panel } from "../../components/ui/primitives";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { useHostDoctorQuery, useInvalidateHostDoctor } from "../../queries/hostDoctor";
import { fixPlan, type HostCheckT } from "./fixPlan";

const STATUS_ICON = { ok: CheckCircle2, warn: AlertTriangle, fail: XCircle } as const;
const STATUS_CLS = { ok: "text-ok", warn: "text-warn", fail: "text-danger" } as const;

export function SetupView({ onClose }: { onClose: () => void }) {
  const installLog = useTraffic((s) => s.installLog);
  const doctorQ = useHostDoctorQuery();
  const refreshDoctor = useInvalidateHostDoctor();
  const checks: HostCheckT[] = doctorQ.data ?? [];
  const loading = doctorQ.isPending;
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [envPreview, setEnvPreview] = useState<string[] | null>(null);

  async function applyFix(fix: string) {
    setBusy(true);
    setRunning(fix);
    setError(null);
    try {
      await invoke("apply_host_fix", { fix });
      await refreshDoctor();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setRunning(null);
    }
  }

  async function setupAll() {
    setBusy(true);
    setError(null);
    for (const fix of fixPlan(checks)) {
      setRunning(fix);
      try {
        await invoke("apply_host_fix", { fix });
      } catch (e) {
        setError(String(e));
        setBusy(false);
        setRunning(null);
        return;
      }
    }
    setRunning(null);
    setBusy(false);
    await refreshDoctor();
  }

  async function askEnvPreview() {
    setError(null);
    try {
      setEnvPreview(await invoke<string[]>("preview_shell_env"));
    } catch (e) {
      setError(String(e));
    }
  }

  const plan = fixPlan(checks);
  const anyFail = checks.some((c) => c.status === "fail");

  return (
    <Panel className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-txt">Setup</p>
          <p className="mt-0.5 text-[11px] text-muted">
            Everything Beholder needs on this machine, from official sources.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void refreshDoctor()}
            disabled={loading || busy}
            title="Re-run checks"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-txt"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-txt"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {loading && checks.length === 0 && (
        <p className="mt-4 text-[12px] text-muted">Checking your environment…</p>
      )}

      {checks.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2.5">
          {checks.map((c) => {
            const Icon = STATUS_ICON[c.status];
            return (
              <li key={c.id} className="flex items-start gap-2.5">
                <Icon size={15} className={clsx("mt-0.5 shrink-0", STATUS_CLS[c.status])} />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-txt">{c.title}</p>
                  <p className="mt-0.5 break-all text-[11px] leading-relaxed text-muted">
                    {c.detail}
                  </p>
                </div>
                {c.fix && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      c.fix === "write_shell_env" ? askEnvPreview() : applyFix(c.fix!)
                    }
                    className="flex shrink-0 items-center gap-1 rounded-md border border-accent/50 px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
                  >
                    {running === c.fix ? (
                      <CircleDashed size={11} className="animate-spin" />
                    ) : (
                      <Zap size={11} />
                    )}
                    Fix
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {envPreview && (
        <div className="mt-3 rounded-md border border-line bg-bg p-2.5">
          <p className="text-[11px] text-muted">This line will be appended to your ~/.zshrc:</p>
          <pre className="mt-1 font-mono text-[11px] text-txt">{envPreview.join("\n")}</pre>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setEnvPreview(null);
                await applyFix("write_shell_env");
              }}
              className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-accent-fg disabled:opacity-40"
            >
              Append to ~/.zshrc
            </button>
            <button
              type="button"
              onClick={() => setEnvPreview(null)}
              className="rounded-md border border-line px-2.5 py-1 text-[11px] text-muted hover:text-txt"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {running && installLog && (
        <p className="mt-3 truncate font-mono text-[11px] text-muted">{installLog}</p>
      )}
      {running && !installLog && <p className="mt-3 text-[11px] text-muted">Running {running}…</p>}

      {error && <ErrorBox message={error} className="mt-3" />}

      {checks.length > 0 && (
        <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
          {plan.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={setupAll}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg disabled:opacity-40"
            >
              {busy ? <CircleDashed size={12} className="animate-spin" /> : <Zap size={12} />} Set
              up everything
            </button>
          )}
          {!anyFail && !loading && (
            <Badge tone="ok" className="ml-auto">
              environment ready
            </Badge>
          )}
        </div>
      )}
    </Panel>
  );
}
