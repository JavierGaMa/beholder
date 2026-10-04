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
import { Badge } from "../../components/ui/primitives";
import { Button } from "../../components/ui/Button";
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
    <div className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-txt">Setup</p>
          <p className="mt-0.5 text-[11px] text-muted">
            Everything Beholder needs on this machine, from official sources.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void refreshDoctor()}
            disabled={loading || busy}
            title="Re-run checks"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} title="Close">
            <X size={14} />
          </Button>
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
                  <Button
                    variant="primary"
                    size="sm"
                    className="shrink-0"
                    disabled={busy}
                    onClick={() =>
                      c.fix === "write_shell_env" ? askEnvPreview() : applyFix(c.fix!)
                    }
                  >
                    {running === c.fix ? (
                      <CircleDashed size={12} className="animate-spin" />
                    ) : (
                      <Zap size={12} />
                    )}
                    Fix
                  </Button>
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
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={async () => {
                setEnvPreview(null);
                await applyFix("write_shell_env");
              }}
            >
              Append to ~/.zshrc
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEnvPreview(null)}>
              Cancel
            </Button>
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
            <Button variant="primary" disabled={busy} onClick={setupAll}>
              {busy ? <CircleDashed size={12} className="animate-spin" /> : <Zap size={12} />} Set
              up everything
            </Button>
          )}
          {!anyFail && !loading && (
            <Badge tone="ok" className="ml-auto">
              environment ready
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
