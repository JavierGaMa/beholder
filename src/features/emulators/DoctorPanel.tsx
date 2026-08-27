import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, RefreshCw, RotateCcw, Zap, X, XCircle } from "lucide-react";
import { invoke } from "../../lib/tauri";
import { Badge } from "../../components/ui/primitives";

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
    <div className="rounded-lg border border-line bg-surface p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-txt">Doctor · {avdName}</p>
          <p className="mt-0.5 font-mono text-[11px] text-muted">{serial}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={run}
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
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => applyFix(c.fix!)}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-accent/50 px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
                  >
                    <Zap size={11} /> Fix
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p className="mt-3 whitespace-pre-wrap rounded-md border border-danger/40 bg-danger/10 p-2 text-[12px] text-danger">
          {error}
        </p>
      )}

      {checks.length > 0 && (
        <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
          {fixable.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={fixAll}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg disabled:opacity-40"
            >
              <Zap size={12} /> Fix all issues
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => applyFix("reboot")}
            title="Last resort — full emulator reboot"
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12px] text-muted hover:text-danger disabled:opacity-40"
          >
            <RotateCcw size={12} /> Reboot
          </button>
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
