import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { invoke, isTauri } from "../../lib/tauri";
import { qError } from "../../lib/query";
import { useApksDirQuery, useApksQuery, useLocalApksQuery } from "../../queries/apks";
import { EmptyState, Panel } from "../../components/ui/primitives";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { toast } from "../../components/ui/toast";
import { useTraffic } from "../../store/traffic";
import { DEFAULT_CONFIG } from "../../lib/theme/config-types";
import { filterApks, type ApkEntry, type EnvFilter } from "./apksFormat";
import { DevicePicker } from "./DevicePicker";
import { ApksOnboarding } from "./ApksOnboarding";
import { SourceChip, TrackCard } from "./ApkTracks";
import { buildTracks, capTracks } from "./apksTracks";
import {
  applyDownloadProgress,
  effectiveDirLabel,
  localFileName,
  matchLocalFiles,
  type DownloadPhase,
} from "./apksLocalState";

const MAX_RENDERED = 200;

const NOW_TICK_MS = 30_000;

const ENV_FILTERS = ["all", "QA", "PROD"] as const;

export function ApksView() {
  const listUrl = useTraffic(
    (s) => s.uiConfig?.apks?.list_url ?? DEFAULT_CONFIG.apks?.list_url ?? "",
  );
  const downloadDir = useTraffic((s) => s.uiConfig?.apks?.download_dir ?? null);
  const configured = listUrl.trim() !== "";
  const apksQ = useApksQuery(listUrl, configured);
  const dirQ = useApksDirQuery(configured);
  const localQ = useLocalApksQuery(configured);
  const queryClient = useQueryClient();
  const entries = apksQ.data ?? [];
  const status = apksQ.isPending && configured ? "loading" : apksQ.error != null ? "error" : "ready";
  const error = qError(apksQ.error);
  const refreshing = apksQ.isFetching && !apksQ.isPending;
  const [serial, setSerial] = useState("");
  const [query, setQuery] = useState("");
  const [env, setEnv] = useState<EnvFilter>("all");
  const [rows, setRows] = useState<Record<string, DownloadPhase>>({});
  const [now, setNow] = useState(() => Date.now());

  async function refresh() {
    await apksQ.refetch();
  }

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    import("@tauri-apps/api/event").then(({ listen }) =>
      listen<{ name: string; received: number; total: number }>("apk-download-progress", (e) => {
        setRows((rows) => applyDownloadProgress(rows, e.payload));
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

  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ["apks-dir"] });
    void queryClient.invalidateQueries({ queryKey: ["apks-local"] });
  }, [downloadDir, queryClient]);

  function setRow(name: string, phase: DownloadPhase) {
    setRows((cur) => ({ ...cur, [name]: phase }));
  }

  async function install(entry: ApkEntry) {
    if (!serial) return;
    const key = localFileName(entry.name);
    try {
      setRow(key, { phase: "downloading", received: 0, total: entry.size_bytes });
      const path = await invoke<string>("download_apk", {
        url: entry.url,
        name: entry.name,
        expectedSizeBytes: entry.size_bytes || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["apks-local"] });
      setRow(key, { phase: "installing" });
      await invoke("install_apk", { serial, path });
      setRow(key, { phase: "done" });
      toast(`installed on ${serial}`);
    } catch (e) {
      setRow(key, { phase: "error", message: String(e) });
      toast(String(e), "danger");
    }
  }

  async function revealDir() {
    try {
      await invoke("reveal_apks_dir");
    } catch (e) {
      toast(String(e), "danger");
    }
  }

  async function revealLocal(entry: ApkEntry) {
    try {
      await invoke("reveal_apk", { name: localFileName(entry.name) });
    } catch (e) {
      toast(String(e), "danger");
      void queryClient.invalidateQueries({ queryKey: ["apks-local"] });
    }
  }

  async function deleteLocal(entry: ApkEntry) {
    try {
      await invoke("delete_apk", { name: localFileName(entry.name) });
    } catch (e) {
      toast(String(e), "danger");
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["apks-local"] });
    }
  }

  const filtered = useMemo(() => filterApks(entries, query, env), [entries, query, env]);
  const tracks = useMemo(() => capTracks(buildTracks(filtered), MAX_RENDERED), [filtered]);
  const dirLabel = effectiveDirLabel(downloadDir, dirQ.data?.dir);
  const localByKey = useMemo(
    () => matchLocalFiles(apksQ.data ?? [], localQ.data ?? []),
    [apksQ.data, localQ.data],
  );

  if (!configured) {
    return (
      <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 overflow-y-auto p-6">
        <h1 className="text-sm font-semibold text-txt">APKs</h1>
        <ApksOnboarding onSaved={() => void refresh()} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold text-txt">APKs</h1>
        <SourceChip listUrl={listUrl} buildCount={entries.length} onSaved={() => void refresh()} />
      </div>

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
            onClick={() => void refresh()}
            disabled={refreshing}
            title="Refetch the build list"
            className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-[12px] text-muted hover:text-txt disabled:opacity-40"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        {dirLabel && (
          <div className="mt-2 flex items-center gap-2">
            <p
              className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted/70"
              title={dirLabel}
            >
              {dirLabel}
            </p>
            <button
              type="button"
              onClick={() => void revealDir()}
              className="h-6 shrink-0 rounded-md border border-line px-2 text-[10px] font-medium text-muted hover:text-txt"
            >
              Reveal
            </button>
          </div>
        )}

        {error && (
          <div className="mt-3 flex items-center gap-2">
            <ErrorBox message={error} compact className="flex-1" />
            <button
              type="button"
              onClick={() => void refresh()}
              className="h-7 shrink-0 rounded-md border border-line px-2 text-[11px] font-medium text-muted hover:text-txt"
            >
              Retry
            </button>
          </div>
        )}

        {status === "loading" ? (
          <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-md bg-surface-2/60" />
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
          <div className="mt-3">
            <div className="flex items-center justify-between px-1 pb-1.5 text-[10px] uppercase tracking-wider text-muted/70">
              <span>{filtered.length} builds</span>
              {refreshing && (
                <span className="flex items-center gap-1 normal-case">
                  <Loader2 size={10} className="animate-spin" /> refreshing
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {tracks.map((track) => (
                <TrackCard
                  key={track.key}
                  track={track}
                  now={now}
                  rows={rows}
                  serial={serial}
                  deviceSelected={serial !== ""}
                  localByKey={localByKey}
                  onInstall={install}
                  onRevealLocal={revealLocal}
                  onDeleteLocal={deleteLocal}
                />
              ))}
            </div>
            {filtered.length > MAX_RENDERED && (
              <p className="px-1 pt-2 text-[11px] text-muted">
                Showing first {MAX_RENDERED} of {filtered.length} — refine your search.
              </p>
            )}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
