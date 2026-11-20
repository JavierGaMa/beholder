import { useState, type ReactNode } from "react";
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
  children,
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
  children?: ReactNode;
}) {
  const [menu, setMenu] = useState<DbMenuTarget | null>(null);
  const closeMenu = () => setMenu(null);
  return (
    <div className="flex flex-col gap-px">
      {dbs.map((db) => {
        const snap = snapshots[snapshotKey(serial, pkg, db.name)];
        const active = selected === db.name;
        const busy = pulling && active;
        return (
          <div key={db.name} className="flex flex-col gap-px">
            <button
              type="button"
              aria-current={active ? "true" : undefined}
              onClick={() => onSelect(db.name)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, name: db.name });
              }}
              disabled={pulling}
              title={snap ? `${db.name} · snapshot pulled at ${formatPulledAt(snap.pulled_at_epoch_ms)}` : db.name}
              className="focus-ring flex h-[30px] w-full items-center gap-2 rounded-[var(--radius-md)] px-2.5 text-left transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40"
            >
              {busy ? (
                <Loader2 size={11} className="shrink-0 animate-spin text-accent" />
              ) : (
                <span
                  className={clsx(
                    "size-1.5 shrink-0 rounded-full",
                    active ? "bg-accent" : snap ? "bg-muted" : "bg-muted/35",
                  )}
                />
              )}
              <span
                className={clsx(
                  "min-w-0 truncate text-[12px]",
                  snap || active ? "font-semibold text-txt" : "text-muted",
                )}
              >
                {db.name}
              </span>
              {db.has_wal && (
                <span
                  title="has a -wal file (unflushed writes are recovered into the snapshot)"
                  className="shrink-0 rounded-[var(--radius-sm)] bg-surface-2 px-1.5 py-px font-mono text-[10px] leading-4 text-muted"
                >
                  wal
                </span>
              )}
              <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted">
                {snap ? humanizeSize(db.size_bytes) : "not pulled"}
              </span>
            </button>
            {active && children}
          </div>
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
