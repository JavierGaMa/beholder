import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, RefreshCw, RotateCcw, Zap, X, XCircle } from "lucide-react";
import { invoke } from "../../lib/tauri";
import { Badge } from "../../components/ui/primitives";
import { Button } from "../../components/ui/Button";
import { ErrorBox } from "../../components/ui/ErrorBox";

type CheckStatus = "ok" | "warn" | "fail";

interface DoctorCheck {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  fix: string | null;
}

const STATUS_ICON = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  fail: XCircle,
} as const;

const STATUS_CLS = {
  ok: "text-ok",
  warn: "text-warn",
  fail: "text-danger",
} as const;

export function DoctorPanel({
  avdName,
  serial,
  onClose,
}: {
  avdName: string;
  serial: string;
  onClose: () => void;
}) {
  const [checks, setChecks] = useState<DoctorCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<DoctorCheck[]>("run_doctor", { serial });
      setChecks(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [serial]);

  useEffect(() => {
    run();
  }, [run]);

  async function applyFix(fix: string) {
    setBusy(true);
    setError(null);
    try {
      await invoke("apply_doctor_fix", { serial, fix });
      if (fix !== "reboot") {
        await run();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function fixAll() {
    setBusy(true);
    setError(null);
    try {
      const fixes = [
        ...new Set(checks.filter((c) => c.fix != null && c.fix !== "reboot").map((c) => c.fix!)),
      ];
      for (const f of fixes) {
        await invoke("apply_doctor_fix", { serial, fix: f });
      }
      await run();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const fixable = checks.filter((c) => c.fix != null);
  const failing = checks.some((c) => c.status !== "ok");

  return (
    <div className="rounded-md border border-line bg-surface p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-txt">Doctor · {avdName}</p>
          <p className="mt-0.5 font-mono text-[11px] text-muted">{serial}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={run}
            disabled={loading || busy}
            title="Re-run checks"
            aria-label="Re-run checks"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} title="Close" aria-label="Close">
            <X size={14} />
          </Button>
        </div>
      </div>

      {loading && checks.length === 0 && (
        <p className="mt-4 text-[12px] text-muted">Running diagnostics…</p>
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
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{c.detail}</p>
                </div>
                {c.fix && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => applyFix(c.fix!)}
                    className="shrink-0 border-accent/50! text-accent! hover:bg-accent/10! hover:text-accent!"
                  >
                    <Zap size={14} /> Fix
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && <ErrorBox message={error} className="mt-3" />}

      {checks.length > 0 && (
        <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
          {fixable.length > 0 && (
            <Button variant="primary" icon={Zap} disabled={busy} onClick={fixAll}>
              Fix all issues
            </Button>
          )}
          <Button
            variant="danger"
            icon={RotateCcw}
            disabled={busy}
            onClick={() => applyFix("reboot")}
            title="Last resort — full emulator reboot"
          >
            Reboot
          </Button>
          {!failing && !loading && (
            <Badge tone="ok" className="ml-auto">
              all healthy
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
