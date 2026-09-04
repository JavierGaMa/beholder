import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { AlertCircle, CircleCheck, Download, Loader2, RefreshCw } from "lucide-react";
import { invoke, isTauri } from "../../lib/tauri";
import type { ApkEntry } from "./apksFormat";
import { Badge, EmptyState, Panel } from "../../components/ui/primitives";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { toast } from "../../components/ui/toast";
import { useApks } from "../../store/apks";
import { downloadPct, filterApks, formatBytes, type EnvFilter } from "./apksFormat";
import { DevicePicker } from "./DevicePicker";

type Phase =
  | { phase: "idle" }
  | { phase: "downloading"; received: number; total: number }
  | { phase: "installing" }
  | { phase: "done" }
  | { phase: "error"; message: string };

const MAX_RENDERED = 200;

const localPaths = new Map<string, string>();

const ENV_FILTERS = ["all", "QA", "PROD"] as const;

function apkMeta(apk: ApkEntry): string {
  return [
    apk.build != null ? `build ${apk.build}` : null,
    apk.flavor,
    apk.date,
    formatBytes(apk.size_bytes),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function ApksView() {
  const entries = useApks((s) => s.entries);
  const status = useApks((s) => s.status);
  const error = useApks((s) => s.error);
  const refreshing = useApks((s) => s.refreshing);
  const refresh = useApks((s) => s.refresh);
  const [serial, setSerial] = useState("");
  const [query, setQuery] = useState("");
  const [env, setEnv] = useState<EnvFilter>("all");
  const [rows, setRows] = useState<Record<string, Phase>>({});

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    import("@tauri-apps/api/event").then(({ listen }) =>
      listen<{ name: string; received: number; total: number }>("apk-download-progress", (e) => {
        setRows((cur) => {
          const row = cur[e.payload.name];
          if (!row || row.phase !== "downloading") return cur;
          return {
            ...cur,
            [e.payload.name]: {
              phase: "downloading",
              received: e.payload.received,
              total: e.payload.total,
            },
          };
        });
      }).then((un) => {
        if (cancelled) un();
        else unlisten = un;
      }),
    );
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  function setRow(name: string, phase: Phase) {
    setRows((cur) => ({ ...cur, [name]: phase }));
  }

  async function install(entry: ApkEntry) {
    if (!serial) return;
    try {
      let path = localPaths.get(entry.name);
      if (!path) {
        setRow(entry.name, { phase: "downloading", received: 0, total: entry.size_bytes });
        path = await invoke<string>("download_apk", { url: entry.url, name: entry.name });
        localPaths.set(entry.name, path);
      }
      setRow(entry.name, { phase: "installing" });
      await invoke("install_apk", { serial, path });
      setRow(entry.name, { phase: "done" });
      toast(`installed on ${serial}`);
    } catch (e) {
      setRow(entry.name, { phase: "error", message: String(e) });
      toast(String(e), "danger");
    }
  }

  const filtered = useMemo(() => filterApks(entries, query, env), [entries, query, env]);
  const visible = filtered.slice(0, MAX_RENDERED);

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 overflow-y-auto p-6">
      <h1 className="text-sm font-semibold text-txt">APKs</h1>

      <Panel className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search builds"
            className="h-7 min-w-40 flex-1 rounded-md border border-line bg-bg px-2 font-mono text-[12px] text-txt placeholder:text-muted/60 focus:border-accent focus:outline-none"
          />
          <div className="flex h-7 overflow-hidden rounded-md border border-line">
            {ENV_FILTERS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setEnv(v)}
                className={clsx(
                  "h-7 px-2 text-[11px] font-medium transition-colors",
                  env === v ? "bg-accent text-accent-fg" : "bg-bg text-muted hover:text-txt",
                )}
              >
                {v === "all" ? "All" : v}
              </button>
            ))}
          </div>
          <DevicePicker serial={serial} onSelect={setSerial} />
          <button
            type="button"
            onClick={() => void refresh(true)}
            disabled={refreshing}
            title="Refetch the build list"
            className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-[12px] text-muted hover:text-txt disabled:opacity-40"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2">
            <ErrorBox message={error} compact className="flex-1" />
            <button
              type="button"
              onClick={() => void refresh(true)}
              className="h-7 shrink-0 rounded-md border border-line px-2 text-[11px] font-medium text-muted hover:text-txt"
            >
              Retry
            </button>
          </div>
        )}

        {status === "loading" ? (
          <div className="mt-3 flex flex-col gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-surface-2/60" />
            ))}
          </div>
        ) : filtered.length === 0 && !error ? (
          <div className="mt-3">
            <EmptyState
              title={entries.length === 0 ? "No builds found" : "No APKs match"}
              hint={
                entries.length === 0
                  ? "Published APKs from the builds container will appear here."
                  : "Adjust the search or environment filter."
              }
            />
          </div>
        ) : filtered.length > 0 ? (
          <div className="mt-3 overflow-hidden rounded-md border border-line">
            <div className="flex items-center justify-between border-b border-line/50 px-3 py-1 text-[10px] uppercase tracking-wider text-muted/70">
              <span>{filtered.length} builds</span>
              {refreshing && (
                <span className="flex items-center gap-1 normal-case">
                  <Loader2 size={10} className="animate-spin" /> refreshing
                </span>
              )}
            </div>
            <div className="divide-y divide-line/60">
              {visible.map((apk) => (
                <ApkRow
                  key={apk.name}
                  apk={apk}
                  state={rows[apk.name] ?? { phase: "idle" }}
                  serial={serial}
                  deviceSelected={serial !== ""}
                  onInstall={() => install(apk)}
                />
              ))}
            </div>
            {visible.length < filtered.length && (
              <p className="px-3 py-2 text-[11px] text-muted">
                Showing first {MAX_RENDERED} of {filtered.length} — refine your search.
              </p>
            )}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

function ApkRow({
  apk,
  state,
  serial,
  deviceSelected,
  onInstall,
}: {
  apk: ApkEntry;
  state: Phase;
  serial: string;
  deviceSelected: boolean;
  onInstall: () => void;
}) {
  const pct = state.phase === "downloading" ? downloadPct(state.received, state.total) : 0;
  const busy = state.phase === "downloading" || state.phase === "installing";
  return (
    <div
      className={clsx(
        "relative flex items-center gap-3 px-3 py-2.5 transition-colors",
        !busy && "hover:bg-surface-2/50",
        busy && "bg-accent/5",
      )}
      title={apk.name}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px] font-semibold text-txt">v{apk.version ?? "?"}</span>
          {apk.env ? (
            <Badge tone={apk.env === "PROD" ? "ok" : "warn"}>{apk.env}</Badge>
          ) : (
            <Badge>unknown</Badge>
          )}
        </div>
        <p className="mt-0.5 truncate text-[11px] text-muted/80">{apkMeta(apk)}</p>
        {state.phase === "error" && (
          <p className="mt-1 flex items-center gap-1 font-mono text-[10px] text-danger">
            <AlertCircle size={10} className="shrink-0" />
            <span className="truncate" title={state.message}>
              {state.message}
            </span>
          </p>
        )}
      </div>
      <div className="shrink-0">
        {state.phase === "done" ? (
          <span className="flex items-center gap-1 text-[11px] font-medium text-ok">
            <CircleCheck size={12} /> installed
          </span>
        ) : state.phase === "installing" ? (
          <span className="flex items-center gap-1.5 text-[11px] text-accent">
            <Loader2 size={12} className="animate-spin" /> installing
          </span>
        ) : state.phase === "downloading" ? (
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-accent">
            <Loader2 size={12} className="animate-spin" /> {pct}%
          </span>
        ) : (
          <button
            type="button"
            onClick={onInstall}
            disabled={!deviceSelected}
            title={deviceSelected ? `Install on ${serial}` : "Select a device first"}
            className={clsx(
              "flex h-7 items-center gap-1 rounded-md px-2.5 text-[11px] font-semibold transition-colors",
              deviceSelected
                ? "bg-accent text-accent-fg"
                : "border border-line text-muted disabled:opacity-40",
            )}
          >
            {state.phase === "error" ? (
              "Retry"
            ) : (
              <>
                <Download size={11} /> Install
              </>
            )}
          </button>
        )}
      </div>
      {state.phase === "downloading" && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-surface-2">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
