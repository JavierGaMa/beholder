import { Download, X } from "lucide-react";
import { useUpdater } from "./useUpdater";
import { bannerTitle, notesLine } from "./updaterFormat";

export function UpdateBanner() {
  const { status, dismissed, installUpdate, dismiss } = useUpdater();

  if (dismissed) return null;
  if (status.kind !== "available" && status.kind !== "downloading" && status.kind !== "installing") {
    return null;
  }

  const label =
    status.kind === "downloading"
      ? `Downloading… ${status.percent}%`
      : status.kind === "installing"
        ? "Installing…"
        : "Update and restart";
  const notes = status.kind === "available" ? notesLine(status.notes) : null;

  return (
    <div className="flex items-center gap-3 border-b border-line bg-surface-2 px-4 py-2 shadow-sm">
      <span className="shrink-0 text-[12px] font-medium text-accent">{bannerTitle(status.version)}</span>
      {notes && <span className="min-w-0 flex-1 truncate text-[11px] text-muted">{notes}</span>}
      <button
        type="button"
        disabled={status.kind !== "available"}
        onClick={installUpdate}
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 text-[12px] font-semibold text-accent-fg transition-colors disabled:opacity-60"
      >
        <Download size={12} />
        {label}
      </button>
      {status.kind !== "installing" && (
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss update banner"
          title="Dismiss"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-bg hover:text-txt"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
