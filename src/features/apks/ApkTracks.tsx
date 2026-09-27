import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  AlertCircle,
  ChevronDown,
  CircleCheck,
  Download,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { invoke } from "../../lib/tauri";
import { qError } from "../../lib/query";
import { toast } from "../../components/ui/toast";
import { useDropdownPosition } from "../../components/ui/popover";
import { Badge, Panel } from "../../components/ui/primitives";
import { downloadPct, formatBytes, type ApkEntry } from "./apksFormat";
import { localFileName, type DownloadPhase, type LocalApk } from "./apksLocalState";
import { formatRelativeLastModified, type BuildTrack } from "./apksTracks";
import {
  applyApksTestResult,
  canSaveApks,
  startApksTest,
  type ApksTestResult,
  type ApksTestState,
} from "./apksOnboardingState";

const URL_PLACEHOLDER =
  "https://<account>.blob.core.windows.net/<container>?restype=container&comp=list&prefix=APKs/";

function sourceHost(listUrl: string): string {
  try {
    return new URL(listUrl).host || "source";
  } catch {
    return "source";
  }
}

function useDismiss(onDismiss: () => void, active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [active, onDismiss]);
  return ref;
}

export function SourceChip({
  listUrl,
  buildCount,
  onSaved,
}: {
  listUrl: string;
  buildCount: number;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(listUrl);
  const [test, setTest] = useState<ApksTestState>({ phase: "idle" });
  const [saving, setSaving] = useState(false);
  const { anchorRef, menuRef, style } = useDropdownPosition(open, { width: 380, estHeight: 280 });
  const ref = useDismiss(() => setOpen(false), open);

  useEffect(() => {
    if (!open) return;
    setUrl(listUrl);
    setTest({ phase: "idle" });
  }, [open, listUrl]);

  const canTest = url.trim() !== "" && test.phase !== "testing";
  const canSave = canSaveApks(test, url) && !saving;

  async function runTest() {
    const trimmed = url.trim();
    setTest(startApksTest(trimmed));
    let result: ApksTestResult;
    try {
      result = await invoke<ApksTestResult>("test_apks_list_url", { listUrl: url });
    } catch (e) {
      result = { ok: false, error: qError(e) ?? String(e) };
    }
    setTest((cur) => applyApksTestResult(cur, trimmed, result));
  }

  async function save() {
    setSaving(true);
    try {
      await invoke("set_apks_config", { listUrl: url });
      setOpen(false);
      onSaved();
    } catch (e) {
      toast(qError(e) ?? String(e), "danger");
    } finally {
      setSaving(false);
    }
  }

  async function removeSource() {
    try {
      await invoke("clear_apks_source");
      setOpen(false);
    } catch (e) {
      toast(String(e), "danger");
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen(!open)}
        title={listUrl}
        className="flex h-7 items-center gap-2 rounded-md border border-line bg-bg px-2 text-[12px] text-txt transition-colors hover:border-muted/50"
      >
        <span className="max-w-52 truncate font-mono">{sourceHost(listUrl)}</span>
        <span className="text-muted">{buildCount} builds</span>
        <ChevronDown
          size={12}
          className={clsx("text-muted transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div
          ref={menuRef}
          style={style}
          className="z-20 rounded-md border border-line bg-surface-2 p-3 shadow-xl"
        >
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted/70">
            Builds source
          </p>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={URL_PLACEHOLDER}
            spellCheck={false}
            className="mt-1.5 h-8 w-full rounded-md border border-line bg-bg px-2 font-mono text-[12px] text-txt placeholder:text-muted/60 focus:border-accent focus:outline-none"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void runTest()}
              disabled={!canTest}
              className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] font-medium text-txt transition-colors hover:border-accent disabled:opacity-40 disabled:hover:border-line"
            >
              {test.phase === "testing" ? <Loader2 size={12} className="animate-spin" /> : null}
              Test connection
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canSave}
              className="flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-[12px] font-semibold text-accent-fg transition-transform hover:scale-[1.01] disabled:opacity-40 disabled:hover:scale-100"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : null}
              Save
            </button>
          </div>
          {test.phase === "ok" && (
            <p className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-ok">
              <CircleCheck size={12} /> {test.count} builds found
            </p>
          )}
          {test.phase === "failed" && (
            <p
              className="mt-2 flex items-start gap-1.5 break-all font-mono text-[11px] text-danger"
              title={test.error}
            >
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              {test.error}
            </p>
          )}
          <div className="mt-3 border-t border-line/60 pt-2">
            <button
              type="button"
              onClick={() => void removeSource()}
              className="flex h-7 items-center gap-1.5 rounded-md border border-danger/40 px-2.5 text-[12px] font-medium text-danger transition-colors hover:bg-danger/10"
            >
              <Trash2 size={12} /> Remove source
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function EnvBadge({ env }: { env: string }) {
  const tone =
    env === "QA"
      ? "border-warn/40 bg-warn/10 text-warn"
      : env === "PROD"
        ? "border-danger/40 bg-danger/10 text-danger"
        : "border-line bg-surface-2 text-muted";
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[11px] font-medium leading-none",
        tone,
      )}
    >
      {env}
    </span>
  );
}

function RowMenu({
  downloaded,
  busy,
  onReveal,
  onDelete,
}: {
  downloaded?: LocalApk;
  busy: boolean;
  onReveal: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(() => setOpen(false), open);
  if (!downloaded) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={busy}
        title="More actions"
        className="flex h-6 w-6 items-center justify-center rounded-md border border-line text-muted transition-colors hover:text-txt disabled:cursor-not-allowed disabled:opacity-40"
      >
        <MoreHorizontal size={12} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-40 rounded-md border border-line bg-surface-2 p-1 shadow-xl">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onReveal();
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-txt/90 transition-colors hover:bg-surface"
          >
            <FolderOpen size={12} /> Reveal file
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-txt/90 transition-colors hover:bg-surface hover:text-danger"
          >
            <Trash2 size={12} /> Delete local copy
          </button>
        </div>
      )}
    </div>
  );
}

function LatestAction({
  state,
  serial,
  deviceSelected,
  onInstall,
}: {
  state: DownloadPhase;
  serial: string;
  deviceSelected: boolean;
  onInstall: () => void;
}) {
  if (state.phase === "done") {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium text-ok">
        <CircleCheck size={12} /> installed
      </span>
    );
  }
  if (state.phase === "installing") {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-accent">
        <Loader2 size={12} className="animate-spin" /> installing
      </span>
    );
  }
  if (state.phase === "downloading") {
    return (
      <span className="flex items-center gap-1.5 font-mono text-[11px] text-accent">
        <Loader2 size={12} className="animate-spin" /> {downloadPct(state.received, state.total)}%
      </span>
    );
  }
  return (
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
          <Download size={12} /> Install
        </>
      )}
    </button>
  );
}

function HistoryAction({
  state,
  serial,
  deviceSelected,
  onInstall,
}: {
  state: DownloadPhase;
  serial: string;
  deviceSelected: boolean;
  onInstall: () => void;
}) {
  if (state.phase === "done") {
    return <CircleCheck size={12} className="text-ok" />;
  }
  if (state.phase === "installing") {
    return <Loader2 size={12} className="animate-spin text-accent" />;
  }
  if (state.phase === "downloading") {
    return (
      <span className="font-mono text-[10px] text-accent">
        {downloadPct(state.received, state.total)}%
      </span>
    );
  }
  const title =
    state.phase === "error"
      ? `Retry — ${state.message}`
      : deviceSelected
        ? `Install on ${serial}`
        : "Select a device first";
  return (
    <button
      type="button"
      onClick={onInstall}
      disabled={!deviceSelected}
      title={title}
      className={clsx(
        "flex h-6 w-6 items-center justify-center rounded-md border border-line text-muted transition-colors hover:text-txt disabled:cursor-not-allowed disabled:opacity-40",
        state.phase === "error" && "border-danger/50 text-danger hover:text-danger",
      )}
    >
      <Download size={12} />
    </button>
  );
}

function HistoryRow({
  apk,
  now,
  state,
  serial,
  deviceSelected,
  downloaded,
  onInstall,
  onReveal,
  onDelete,
}: {
  apk: ApkEntry;
  now: number;
  state: DownloadPhase;
  serial: string;
  deviceSelected: boolean;
  downloaded?: LocalApk;
  onInstall: () => void;
  onReveal: () => void;
  onDelete: () => void;
}) {
  const busy = state.phase === "downloading" || state.phase === "installing";
  const rel = formatRelativeLastModified(apk.last_modified, now);
  return (
    <div className="flex items-center gap-2 py-1.5" title={apk.name}>
      <span
        className={clsx(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          downloaded ? "bg-ok" : "bg-line",
        )}
        title={downloaded ? "Downloaded" : "Not downloaded"}
      />
      <span className="shrink-0 font-mono text-[12px] text-txt/90">v{apk.version ?? "?"}</span>
      {apk.build != null && (
        <span className="shrink-0 font-mono text-[10px] text-muted">#{apk.build}</span>
      )}
      <span className="min-w-0 flex-1 truncate text-[10px] text-muted/80">
        {[rel, formatBytes(apk.size_bytes)].filter(Boolean).join(" · ")}
      </span>
      <div className="flex shrink-0 items-center gap-1.5">
        <HistoryAction
          state={state}
          serial={serial}
          deviceSelected={deviceSelected}
          onInstall={onInstall}
        />
        <RowMenu downloaded={downloaded} busy={busy} onReveal={onReveal} onDelete={onDelete} />
      </div>
    </div>
  );
}

export function TrackCard({
  track,
  now,
  rows,
  serial,
  deviceSelected,
  localByKey,
  onInstall,
  onRevealLocal,
  onDeleteLocal,
}: {
  track: BuildTrack;
  now: number;
  rows: Record<string, DownloadPhase>;
  serial: string;
  deviceSelected: boolean;
  localByKey: Record<string, LocalApk>;
  onInstall: (entry: ApkEntry) => void;
  onRevealLocal: (entry: ApkEntry) => void;
  onDeleteLocal: (entry: ApkEntry) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const latest = track.latest;
  const latestKey = localFileName(latest.name);
  const state = rows[latestKey] ?? { phase: "idle" };
  const busy = state.phase === "downloading" || state.phase === "installing";
  const downloaded = localByKey[latestKey];
  const rel = formatRelativeLastModified(latest.last_modified, now);

  return (
    <Panel className="flex flex-col p-3">
      <div className="flex items-center gap-2">
        <EnvBadge env={track.env} />
        <span
          className="min-w-0 flex-1 truncate font-mono text-[12px] text-txt/90"
          title={track.flavor}
        >
          {track.flavor}
        </span>
        {track.history.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-line px-1.5 text-[11px] text-muted transition-colors hover:text-txt"
          >
            {track.history.length} previous
            <ChevronDown
              size={12}
              className={clsx("transition-transform", showHistory && "rotate-180")}
            />
          </button>
        )}
      </div>

      <div className="mt-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5" title={latest.name}>
            <span className="font-mono text-[15px] font-semibold text-txt">
              v{latest.version ?? "?"}
            </span>
            {latest.build != null && (
              <span className="font-mono text-[11px] text-muted">#{latest.build}</span>
            )}
            {rel && <span className="text-[11px] text-muted/80">{rel}</span>}
            <span className="font-mono text-[11px] text-muted/80">
              {formatBytes(latest.size_bytes)}
            </span>
            {downloaded && <Badge tone="ok">local</Badge>}
          </div>
          {state.phase === "downloading" && (
            <div className="mt-2 h-1 w-full max-w-64 overflow-hidden rounded bg-surface-2">
              <div
                className="h-full bg-accent transition-[width]"
                style={{ width: `${downloadPct(state.received, state.total)}%` }}
              />
            </div>
          )}
          {state.phase === "error" && (
            <p className="mt-1.5 flex items-center gap-1 font-mono text-[10px] text-danger">
              <AlertCircle size={10} className="shrink-0" />
              <span className="truncate" title={state.message}>
                {state.message}
              </span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <LatestAction
            state={state}
            serial={serial}
            deviceSelected={deviceSelected}
            onInstall={() => onInstall(latest)}
          />
          <RowMenu
            downloaded={downloaded}
            busy={busy}
            onReveal={() => onRevealLocal(latest)}
            onDelete={() => onDeleteLocal(latest)}
          />
        </div>
      </div>

      {showHistory && (
        <div className="mt-2.5 divide-y divide-line/60 border-t border-line/60">
          {track.history.map((apk) => {
            const key = localFileName(apk.name);
            return (
              <HistoryRow
                key={key}
                apk={apk}
                now={now}
                state={rows[key] ?? { phase: "idle" }}
                serial={serial}
                deviceSelected={deviceSelected}
                downloaded={localByKey[key]}
                onInstall={() => onInstall(apk)}
                onReveal={() => onRevealLocal(apk)}
                onDelete={() => onDeleteLocal(apk)}
              />
            );
          })}
        </div>
      )}
    </Panel>
  );
}
