import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { AlertCircle, ArrowRight, Check, Loader2, RotateCcw, X } from "lucide-react";
import { invoke } from "../../lib/tauri";
import { useTraffic } from "../../store/traffic";

type StepStatus = "pending" | "active" | "done" | "error";


const STEP_BOOT = 1;
const STEP_CAPTURE = 2;
const STEP_DONE = 3;

const BOOT_STEP_LABELS = ["Emulator created", "Booting emulator", "Starting capture", "Capturing"];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function OnboardingPanel({
  avdName,
  createdNew,
  onCancel,
}: {
  avdName: string;
  createdNew: boolean;
  onCancel: () => void;
}) {
  const setCapture = useTraffic((s) => s.setCapture);
  const setActiveView = useTraffic((s) => s.setActiveView);
  const [statuses, setStatuses] = useState<StepStatus[]>(() =>
    createdNew ? ["done", "active", "pending", "pending"] : ["pending", "active", "pending", "pending"],
  );
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string>("waiting for the emulator to appear in adb");
  const [elapsed, setElapsed] = useState(0);
  const [port, setPort] = useState<number | null>(null);
  const serialRef = useRef<string | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    if (statuses[STEP_BOOT] !== "active") return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [statuses]);

  useEffect(() => {
    runFrom(STEP_BOOT);
  }, []);

  async function setStatus(idx: number, status: StepStatus) {
    setStatuses((prev) => {
      const next = [...prev];
      next[idx] = status;
      return next;
    });
  }

  async function runFrom(step: number) {
    if (runningRef.current) return;
    runningRef.current = true;
    setError(null);
    try {
      if (step === STEP_BOOT) {
        setStatus(STEP_BOOT, "active");
        setDetail("waiting for the emulator to appear in adb");
        let serial: string | null = null;
        const started = Date.now();
        while (Date.now() - started < 30_000) {
          try {
            serial = await invoke<string>("resolve_serial_for_avd", { name: avdName });
            break;
          } catch {
            await sleep(2000);
          }
        }
        if (!serial) {
          throw new Error("emulator never became visible to adb — is the emulator window opening?");
        }
        serialRef.current = serial;
        setDetail("waiting for Android to finish booting (this takes 30-60s)");
        await invoke("wait_booted", { serial });
        setStatus(STEP_BOOT, "done");
        step = STEP_CAPTURE;
      }
      if (step === STEP_CAPTURE) {
        setStatus(STEP_CAPTURE, "active");
        setDetail("installing CA certificate and starting the proxy");
        const p = await invoke<number>("capture_start", { serial: serialRef.current });
        setPort(p);
        setCapture(true, p);
        setStatus(STEP_CAPTURE, "done");
        setStatus(STEP_DONE, "done");
        setDetail("");
      }
    } catch (e) {
      setStatus(step, "error");
      setError(String(e).replace(/^Error: /, ""));
    } finally {
      runningRef.current = false;
    }
  }

  async function retry() {
    setStatuses((prev) => {
      const next = [...prev];
      const failedIdx = next.findIndex((s) => s === "error");
      if (failedIdx >= 0) next[failedIdx] = "active";
      return next;
    });
    const failedIdx = statuses.findIndex((s) => s === "error");
    const step = failedIdx === STEP_CAPTURE ? STEP_CAPTURE : STEP_BOOT;
    runningRef.current = false;
    runFrom(step);
  }

  const failed = statuses.some((s) => s === "error");
  const finished = statuses[STEP_DONE] === "done";

  return (
    <div className="rounded-lg border border-line bg-surface p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-txt">Getting you to live traffic</p>
          <p className="mt-0.5 text-[12px] text-muted">
            {finished
              ? "Beholder is inspecting this emulator."
              : `Setting up ${avdName} — you can watch the emulator window boot in parallel.`}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          title="Dismiss"
          className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-txt"
        >
          <X size={14} />
        </button>
      </div>

      <ol className="mt-4 flex flex-col gap-3">
        {BOOT_STEP_LABELS.map((label, i) => {
          const st = statuses[i];
          return (
            <li key={label} className="flex items-start gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                {st === "done" && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ok/15">
                    <Check size={12} className="text-ok" />
                  </span>
                )}
                {st === "active" && <Loader2 size={16} className="animate-spin text-accent" />}
                {st === "error" && <AlertCircle size={16} className="text-danger" />}
                {st === "pending" && <span className="h-2 w-2 rounded-full bg-muted/40" />}
              </span>
              <div className="min-w-0">
                <p
                  className={clsx(
                    "text-[13px] font-medium",
                    st === "pending" ? "text-muted/60" : "text-txt",
                    st === "active" && "text-accent",
                  )}
                >
                  {label}
                </p>
                {st === "active" && detail && (
                  <p className="mt-0.5 text-[11px] text-muted">
                    {detail}
                    {i === STEP_BOOT && elapsed > 2 ? ` · ${elapsed}s` : ""}
                  </p>
                )}
                {i === STEP_DONE && finished && (
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                    Open your React Native app on the emulator — its network traffic appears here in
                    real time. Proxy :{port} · CA installed as system cert.
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {failed && (
        <div className="mt-4 rounded-md border border-danger/40 bg-danger/10 p-3">
          <p className="text-[12px] leading-relaxed text-danger">{error}</p>
          <div className="mt-2.5 flex items-center gap-3">
            <button
              type="button"
              onClick={retry}
              className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-[12px] font-semibold text-accent-fg"
            >
              <RotateCcw size={12} /> Retry step
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="text-[12px] text-muted underline-offset-2 hover:text-txt hover:underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {finished && (
        <button
          type="button"
          onClick={() => {
            onCancel();
            setActiveView("requests");
          }}
          className="mt-4 flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-[12px] font-semibold text-accent-fg transition-transform hover:scale-[1.01]"
        >
          View requests <ArrowRight size={13} />
        </button>
      )}
    </div>
  );
}
