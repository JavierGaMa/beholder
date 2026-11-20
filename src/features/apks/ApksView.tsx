import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { invoke, isTauri } from "../../lib/tauri";
import { qError } from "../../lib/query";
import { useApksDirQuery, useApksQuery, useLocalApksQuery } from "../../queries/apks";
import { EmptyState } from "../../components/ui/primitives";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { toast } from "../../components/ui/toast";
import { useTraffic } from "../../store/traffic";
import { DEFAULT_CONFIG } from "../../lib/theme/config-types";
import { filterApks, type ApkEntry, type EnvFilter } from "./apksFormat";
import { DevicePicker } from "./DevicePicker";
import { ApksOnboarding } from "./ApksOnboarding";
import { BUILD_GRID, BuildRow, SourceChip } from "./ApkTracks";
import { sortByLastModifiedDesc } from "./apksTracks";
import { envCounts } from "./apksList";
import {
  applyDownloadProgress,
  effectiveDirLabel,
  localFileName,
  matchLocalFiles,
  type DownloadPhase,
} from "./apksLocalState";

const MAX_RENDERED = 200;

const NOW_TICK_MS = 30_000;

const ENV_LABELS: readonly { value: EnvFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "QA", label: "QA" },
  { value: "PROD", label: "PROD" },
];

const COLUMNS = ["Track", "Version", "Build", "Flavor", "Size", "Published", ""];

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
  const builds = useMemo(
    () => sortByLastModifiedDesc(filtered).slice(0, MAX_RENDERED),
    [filtered],
  );
  const counts = useMemo(() => envCounts(entries, query), [entries, query]);
  const envOptions = useMemo(
    () => ENV_LABELS.map((o) => ({ value: o.value, label: `${o.label} ${counts[o.value]}` })),
    [counts],
  );
  const dirLabel = effectiveDirLabel(downloadDir, dirQ.data?.dir);
  const localByKey = useMemo(
    () => matchLocalFiles(apksQ.data ?? [], localQ.data ?? []),
    [apksQ.data, localQ.data],
  );

  if (!configured) {
    return (
      <div className="panel flex h-full flex-col gap-4 overflow-y-auto p-6">
        <h1 className="text-sm font-semibold text-txt">APKs</h1>
        <ApksOnboarding onSaved={() => void refresh()} />
      </div>
    );
  }

  return (
    <section className="panel flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-3">
        <div className="w-80 min-w-40">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search builds"
            aria-label="Search builds"
          />
        </div>
        <SegmentedControl
          options={envOptions}
          value={env}
          onChange={setEnv}
          ariaLabel="Environment filter"
        />
        <span className="flex-1" />
        <span className="truncate text-[12px] text-muted">
          {serial ? `Installs go to ${serial}` : "Select a device to install"}
        </span>
        <DevicePicker serial={serial} onSelect={setSerial} />
        <SourceChip listUrl={listUrl} buildCount={entries.length} onSaved={() => void refresh()} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refresh()}
          disabled={refreshing}
          title="Refetch the build list"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> Refresh
        </Button>
      </div>

      {error && (
        <div className="flex shrink-0 items-center gap-2 px-3 pb-3">
          <ErrorBox message={error} compact className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => void refresh()} className="shrink-0">
            Retry
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {status === "loading" ? (
          <ul className="flex flex-col gap-0.5" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <li key={i} className={clsx(BUILD_GRID, "h-[52px] px-3")}>
                {COLUMNS.map((_, j) => (
                  <span
                    key={j}
                    className={clsx(
                      "h-3 animate-pulse rounded bg-surface-2",
                      j === COLUMNS.length - 1 ? "ml-auto w-16" : "w-3/4",
                    )}
                  />
                ))}
              </li>
            ))}
          </ul>
        ) : filtered.length === 0 && !error ? (
          <EmptyState
            title={entries.length === 0 ? "No builds found" : "No APKs match"}
            hint={
              entries.length === 0
                ? "Published APKs from the builds container will appear here."
                : "Adjust the search or environment filter."
            }
          />
        ) : filtered.length > 0 ? (
          <>
            <div
              className={clsx(
                BUILD_GRID,
                "sticky top-0 z-10 h-9 bg-surface px-3 text-[11px] text-muted",
              )}
            >
              {COLUMNS.map((c, i) => (
                <span key={i}>{c}</span>
              ))}
            </div>
            <ul className="flex flex-col gap-0.5 pb-2">
              {builds.map((apk, i) => (
                <BuildRow
                  key={apk.name}
                  apk={apk}
                  now={now}
                  state={rows[localFileName(apk.name)] ?? { phase: "idle" }}
                  serial={serial}
                  deviceSelected={serial !== ""}
                  primary={i === 0}
                  downloaded={localByKey[localFileName(apk.name)]}
                  onInstall={install}
                  onRevealLocal={revealLocal}
                  onDeleteLocal={deleteLocal}
                />
              ))}
            </ul>
          </>
        ) : null}
      </div>

      <div className="flex h-11 shrink-0 items-center gap-2 border-t border-line px-4 text-[12px] text-muted">
        <span className="truncate">
          {filtered.length > MAX_RENDERED
            ? `Showing first ${MAX_RENDERED} of ${filtered.length} builds — refine your search.`
            : `Showing ${builds.length} of ${entries.length} builds`}
        </span>
        {refreshing && (
          <span className="flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" /> refreshing
          </span>
        )}
        <span className="flex-1" />
        {dirLabel && (
          <Button
            variant="ghost"
            size="sm"
            icon={FolderOpen}
            onClick={() => void revealDir()}
            title={dirLabel}
          >
            Open downloads folder
          </Button>
        )}
      </div>
    </section>
  );
}
