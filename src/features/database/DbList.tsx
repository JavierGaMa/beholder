import { useState } from "react";
import clsx from "clsx";
import { FolderOpen, Loader2, RefreshCw, Trash2 } from "lucide-react";
import type { DbFile, SnapshotInfo } from "../../queries/databases";
import { ContextMenu } from "../../components/ui/ContextMenu";
import { formatPulledAt, humanizeSize, snapshotKey } from "./dbdisplay";

interface DbMenuTarget {
  x: number;
  y: number;
  name: string;
}

export function DbList({
  dbs,
  serial,
  pkg,
  selected,
  pulling,
  snapshots,
  onSelect,
  onDeleteSnapshot,
  onRevealSnapshot,
}: {
  dbs: DbFile[];
  serial: string;
  pkg: string;
  selected: string | null;
  pulling: boolean;
  snapshots: Record<string, SnapshotInfo>;
  onSelect: (name: string) => void;
  onDeleteSnapshot: (name: string) => void;
  onRevealSnapshot: (name: string) => void;
}) {
  const [menu, setMenu] = useState<DbMenuTarget | null>(null);
  const closeMenu = () => setMenu(null);
  return (
    <div className="flex flex-col gap-0.5">
      {dbs.map((db) => {
        const snap = snapshots[snapshotKey(serial, pkg, db.name)];
        const active = selected === db.name;
        const busy = pulling && active;
        return (
          <button
            key={db.name}
            type="button"
            onClick={() => onSelect(db.name)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, name: db.name });
            }}
            disabled={pulling}
            title={snap ? `${db.name} · snapshot pulled at ${formatPulledAt(snap.pulled_at_epoch_ms)}` : db.name}
            className={clsx(
              "focus-ring group flex w-full flex-col gap-0.5 rounded-md border px-2.5 py-2 text-left transition-colors disabled:pointer-events-none disabled:opacity-40",
              active
                ? "border-accent/40 bg-accent/10"
                : "border-transparent hover:border-line hover:bg-surface-2",
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              {busy ? (
                <Loader2 size={12} className="shrink-0 animate-spin text-accent" />
              ) : (
                <span
                  className={clsx(
                    "size-1.5 shrink-0 rounded-full",
                    active ? "bg-accent" : snap ? "bg-ok/70" : "bg-muted/40",
                  )}
                />
              )}
              <span
                className={clsx(
                  "min-w-0 flex-1 truncate font-mono text-[12px]",
                  active ? "text-accent" : "text-txt/90",
                )}
              >
                {db.name}
              </span>
              {db.has_wal && (
                <span
                  title="has a -wal file (unflushed writes are recovered into the snapshot)"
                  className="shrink-0 rounded border border-warn/40 bg-warn/10 px-1 py-px font-mono text-[9px] font-medium leading-none text-warn"
                >
                  wal
                </span>
              )}
            </span>
            <span className="flex items-center gap-2 pl-3.5 text-[10px] text-muted/80">
              <span className="font-mono">{humanizeSize(db.size_bytes)}</span>
              {snap && (
                <>
                  <span className="text-muted/50">·</span>
                  <span className="font-mono">pulled {formatPulledAt(snap.pulled_at_epoch_ms)}</span>
                </>
              )}
            </span>
          </button>
        );
      })}
      {menu != null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          items={[
            {
              label: "Re-pull snapshot",
              icon: RefreshCw,
              disabled: pulling,
              onSelect: () => onSelect(menu.name),
            },
            {
              label: "Delete local snapshot",
              icon: Trash2,
              danger: true,
              onSelect: () => onDeleteSnapshot(menu.name),
            },
            {
              label: "Reveal in Finder",
              icon: FolderOpen,
              disabled: snapshots[snapshotKey(serial, pkg, menu.name)] == null,
              onSelect: () => onRevealSnapshot(menu.name),
            },
          ]}
        />
      )}
    </div>
  );
}
