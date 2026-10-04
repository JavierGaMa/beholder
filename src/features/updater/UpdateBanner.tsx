import { Download, X } from "lucide-react";
import { useUpdater } from "./useUpdater";
import { bannerTitle, notesLine } from "./updaterFormat";
import { Button } from "../../components/ui/Button";

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
    <div className="flex shrink-0 items-center gap-3 border-b border-line bg-surface-2 px-4 py-2 shadow-sm">
      <span className="shrink-0 text-[12px] font-medium text-accent">{bannerTitle(status.version)}</span>
      {notes && <span className="min-w-0 flex-1 truncate text-[11px] text-muted">{notes}</span>}
      <Button
        variant="primary"
        size="sm"
        icon={Download}
        className="shrink-0"
        disabled={status.kind !== "available"}
        onClick={installUpdate}
      >
        {label}
      </Button>
      {status.kind !== "installing" && (
        <Button
          variant="ghost"
          size="icon"
          onClick={dismiss}
          aria-label="Dismiss update banner"
          title="Dismiss"
        >
          <X size={13} />
        </Button>
      )}
    </div>
  );
}
