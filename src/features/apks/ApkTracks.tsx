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
import { Badge } from "../../components/ui/primitives";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Menu } from "../../components/ui/Menu";
import { downloadPct, formatBytes, type ApkEntry } from "./apksFormat";
import { localFileName, type DownloadPhase, type LocalApk } from "./apksLocalState";
import { formatRelativeLastModified, normalizedEnv, normalizedFlavor } from "./apksTracks";
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
      <Button
        ref={anchorRef}
        variant="subtle"
        size="sm"
        onClick={() => setOpen(!open)}
        title={listUrl}
      >
        <span className="max-w-52 truncate font-mono">{sourceHost(listUrl)}</span>
        <span className="text-muted">{buildCount} builds</span>
        <ChevronDown
          size={14}
          className={clsx("text-muted transition-transform", open && "rotate-180")}
        />
      </Button>
      {open && (
        <div
          ref={menuRef}
          style={style}
          className="anim-pop-in z-20 rounded-[var(--radius-md)] border border-line bg-surface-2 p-3 text-left shadow-[var(--shadow-3)]"
        >
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted/70">
            Builds source
          </p>
          <div className="mt-1.5">
            <Input
              mono
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={URL_PLACEHOLDER}
              spellCheck={false}
            />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Button
              variant="subtle"
              size="sm"
              onClick={() => void runTest()}
              disabled={!canTest}
            >
              {test.phase === "testing" ? <Loader2 size={14} className="animate-spin" /> : null}
              Test connection
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void save()}
              disabled={!canSave}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              Save
            </Button>
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
            <Button
              variant="danger"
              size="sm"
              icon={Trash2}
              onClick={() => void removeSource()}
            >
              Remove source
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function EnvBadge({ env }: { env: string }) {
  const tone = env === "QA" ? "warn" : env === "PROD" ? "danger" : "muted";
  return <Badge tone={tone}>{env}</Badge>;
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
  if (!downloaded) return null;
  return (
    <Menu
      items={[
        { key: "reveal", label: "Reveal file", icon: FolderOpen, onSelect: onReveal },
        { key: "delete", label: "Delete local copy", icon: Trash2, danger: true, onSelect: onDelete },
      ]}
      onClose={() => {}}
      width={168}
      trigger={(t) => (
        <Button
          ref={t.ref}
          variant="ghost"
          size="icon"
          onClick={t.onClick}
          disabled={busy}
          aria-haspopup="menu"
          aria-expanded={t["aria-expanded"]}
          title="More actions"
          aria-label="More actions"
        >
          <MoreHorizontal size={14} />
        </Button>
      )}
    />
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
    <Button
      variant="primary"
      size="sm"
      onClick={onInstall}
      disabled={!deviceSelected}
      title={deviceSelected ? `Install on ${serial}` : "Select a device first"}
    >
      {state.phase === "error" ? (
        "Retry"
      ) : (
        <>
          <Download size={14} /> Install
        </>
      )}
    </Button>
  );
}

export function BuildCard({
  apk,
  now,
  state,
  serial,
  deviceSelected,
  downloaded,
  onInstall,
  onRevealLocal,
  onDeleteLocal,
}: {
  apk: ApkEntry;
  now: number;
  state: DownloadPhase;
  serial: string;
  deviceSelected: boolean;
  downloaded?: LocalApk;
  onInstall: (entry: ApkEntry) => void;
  onRevealLocal: (entry: ApkEntry) => void;
  onDeleteLocal: (entry: ApkEntry) => void;
}) {
  const busy = state.phase === "downloading" || state.phase === "installing";
  const env = normalizedEnv(apk.env);
  const flavor = normalizedFlavor(apk.flavor);
  const rel = formatRelativeLastModified(apk.last_modified, now);
  const displayName = apk.version
    ? `v${apk.version}`
    : localFileName(apk.name).replace(/\.apk$/i, "");
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3 transition-colors hover:border-accent/50">
      <div className="flex min-w-0 items-center gap-2">
        <EnvBadge env={env} />
        <span
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted"
          title={flavor}
        >
          {flavor}
        </span>
        {rel && <span className="shrink-0 text-[10px] text-muted/80">{rel}</span>}
      </div>

      <div className="min-w-0" title={apk.name}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="min-w-0 truncate font-mono text-[15px] font-semibold text-txt">
            {displayName}
          </span>
          {apk.build != null && (
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
              #{apk.build}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="font-mono text-[11px] tabular-nums text-muted/80">
            {formatBytes(apk.size_bytes)}
          </span>
          {downloaded && <Badge tone="ok">local</Badge>}
        </div>
      </div>

      {state.phase === "downloading" && (
        <div className="h-1 w-full overflow-hidden rounded bg-surface-2">
          <div
            className="h-full bg-accent transition-[width]"
            style={{ width: `${downloadPct(state.received, state.total)}%` }}
          />
        </div>
      )}
      {state.phase === "error" && (
        <p className="flex items-center gap-1 font-mono text-[10px] text-danger">
          <AlertCircle size={10} className="shrink-0" />
          <span className="truncate" title={state.message}>
            {state.message}
          </span>
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2">
        <LatestAction
          state={state}
          serial={serial}
          deviceSelected={deviceSelected}
          onInstall={() => onInstall(apk)}
        />
        <RowMenu
          downloaded={downloaded}
          busy={busy}
          onReveal={() => onRevealLocal(apk)}
          onDelete={() => onDeleteLocal(apk)}
        />
      </div>
    </div>
  );
}
