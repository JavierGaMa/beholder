import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import clsx from "clsx";
import { AlertTriangle, Check, RefreshCw, RotateCcw, X, Zap } from "lucide-react";
import { invoke } from "../../lib/tauri";
import { Badge } from "../../components/ui/primitives";
import { Button } from "../../components/ui/Button";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { doctorSummary } from "./emulatorSelection";

type CheckStatus = "ok" | "warn" | "fail";

interface DoctorCheck {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  fix: string | null;
}

const STATUS_ICON = {
  ok: Check,
  warn: AlertTriangle,
  fail: X,
} as const;

const STATUS_CLS = {
  ok: "text-ok",
  warn: "text-warn",
  fail: "text-danger",
} as const;

export function DoctorPanel({
  avdName,
  serial,
  facts,
}: {
  avdName: string;
  serial: string;
  facts: ReactNode;
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

  const summary = doctorSummary(checks);
  const failing = checks.some((c) => c.status !== "ok");

  return (
    <div className="flex flex-col">
      <div className="flex min-h-12 items-center gap-2">
        <span className="truncate font-mono text-[13px] font-semibold text-txt">{avdName}</span>
        <span className="truncate font-mono text-[12px] text-muted">{serial}</span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          icon={RefreshCw}
          onClick={run}
          disabled={loading || busy}
          title="Run the capture health checks again"
          className={clsx("shrink-0 whitespace-nowrap", loading && "[&_svg]:animate-spin")}
        >
          Run checks again
        </Button>
      </div>

      {facts}

      <div className="mt-5 flex items-baseline gap-2">
        <p className="text-[12px] font-semibold text-txt">Capture health</p>
        {checks.length > 0 && (
          <span className="text-[12px] text-muted">
            {summary.passing} of {summary.total} checks pass
          </span>
        )}
        {checks.length > 0 && !failing && !loading && (
          <Badge tone="ok" className="ml-auto">
            all healthy
          </Badge>
        )}
      </div>

      {loading && checks.length === 0 && (
        <p className="mt-3 text-[12px] text-muted">Running diagnostics…</p>
      )}

      {checks.length > 0 && (
        <ul className="mt-2 flex flex-col">
          {checks.map((c) => {
            const Icon = STATUS_ICON[c.status];
            return (
              <li key={c.id} className="flex items-start gap-3 border-b border-line py-3">
                <Icon size={14} className={clsx("mt-0.5 shrink-0", STATUS_CLS[c.status])} />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-txt">{c.title}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{c.detail}</p>
                </div>
                {c.fix && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Zap}
                    disabled={busy}
                    onClick={() => applyFix(c.fix!)}
                    className="shrink-0"
                  >
                    Fix
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && <ErrorBox message={error} className="mt-3" />}

      {checks.length > 0 && (
        <div className="mt-4 flex items-center gap-2">
          {summary.fixCount > 0 && (
            <Button variant="primary" size="sm" icon={Zap} disabled={busy} onClick={fixAll}>
              Fix {summary.fixCount} {summary.fixCount === 1 ? "issue" : "issues"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={RotateCcw}
            disabled={busy}
            onClick={() => applyFix("reboot")}
            title="Last resort — full emulator reboot"
            className="hover:bg-danger/10! hover:text-danger!"
          >
            Reboot emulator
          </Button>
        </div>
      )}
    </div>
  );
}
