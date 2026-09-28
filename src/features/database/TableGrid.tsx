import { Fragment, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import clsx from "clsx";
import { Ban, ChevronDown, ChevronUp, ChevronsUpDown, Copy, Pencil, Table, Trash2, type LucideIcon } from "lucide-react";
import type { TableOrder, TablePage } from "../../queries/databases";
import { toast } from "../../components/ui/toast";
import { classifyCell, columnTitle } from "./dbdisplay";
import {
  cellMenuItems,
  cellText,
  formatMarkdownTable,
  type CellMenuAction,
  type CellMenuItem,
} from "./queryResults";
import { cellValueFromInput } from "./writes";

const MENU_ICONS: Record<CellMenuAction, LucideIcon> = {
  edit: Pencil,
  "set-null": Ban,
  "delete-row": Trash2,
  "copy-value": Copy,
  "copy-row": Table,
};

function ContextMenu({
  x,
  y,
  items,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  items: CellMenuItem[];
  onPick: (id: CellMenuAction) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (el == null) return;
    const left = Math.max(4, Math.min(x, window.innerWidth - el.offsetWidth - 4));
    const top = Math.max(4, Math.min(y, window.innerHeight - el.offsetHeight - 4));
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current != null && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 min-w-[160px] rounded-md border border-line bg-surface p-1 text-[12px] shadow-lg"
    >
      {items.map((item, i) => {
        const Icon = MENU_ICONS[item.id];
        return (
          <Fragment key={item.id}>
            {item.id === "copy-value" && i > 0 && <div className="my-1 border-t border-line" />}
            <button
              type="button"
              role="menuitem"
              onClick={() => onPick(item.id)}
              className={clsx(
                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left",
                item.danger ? "text-danger hover:bg-danger/10" : "text-txt hover:bg-surface-2",
              )}
            >
              <Icon size={11} className="shrink-0" />
              {item.label}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

function Cell({ value, onEdit }: { value: unknown; onEdit?: () => void }) {
  const cell = classifyCell(value);
  if (cell.kind === "null") {
    return (
      <span
        onDoubleClick={onEdit}
        className="block max-w-[320px] truncate italic text-muted/45"
        title="NULL"
      >
        null
      </span>
    );
  }
  if (cell.kind === "number") {
    return (
      <span
        onDoubleClick={onEdit}
        className="block max-w-[320px] truncate font-mono tabular-nums text-txt/90"
        title={cell.text}
      >
        {cell.text}
      </span>
    );
  }
  if (cell.kind === "blob") {
    return (
      <span
        onDoubleClick={onEdit}
        className="block max-w-[320px] truncate font-mono text-muted/60"
        title={cell.text}
      >
        {cell.text}
      </span>
    );
  }
  return (
    <span
      onDoubleClick={onEdit}
      className="block max-w-[320px] truncate text-txt/90"
      title={cell.text}
    >
      {cell.text}
    </span>
  );
}

function EditableCell({
  value,
  onCommit,
  editSignal = 0,
}: {
  value: unknown;
  onCommit: (next: number | string | null) => void;
  editSignal?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const settled = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (draft != null) inputRef.current?.focus();
  }, [draft]);

  useEffect(() => {
    if (editSignal === 0) return;
    settled.current = false;
    const display = classifyCell(value);
    setDraft(display.kind === "null" ? "" : display.text);
  }, [editSignal]);

  if (draft == null) {
    return (
      <Cell
        value={value}
        onEdit={() => {
          const display = classifyCell(value);
          settled.current = false;
          setDraft(display.kind === "null" ? "" : display.text);
        }}
      />
    );
  }
  return (
    <input
      ref={inputRef}
      value={draft}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (!settled.current) setDraft(null);
        settled.current = false;
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          settled.current = true;
          const text = draft;
          setDraft(null);
          onCommit(cellValueFromInput(text, value));
        } else if (e.key === "Escape") {
          e.preventDefault();
          settled.current = true;
          setDraft(null);
        }
      }}
      title="Enter commits, Escape cancels"
      className="w-full max-w-[320px] rounded-sm border border-accent/60 bg-surface-2 px-1 py-px font-mono text-[12px] text-txt outline-none"
    />
  );
}

interface CellMenuTarget {
  x: number;
  y: number;
  col: string | null;
  value: unknown;
  row: Record<string, unknown>;
  rowKey: number;
  rowid: number | null;
}

export function TableGrid({
  page,
  offsetBase,
  order = null,
  onSort,
  editing = false,
  onCommitCell,
  onDeleteRow,
  copyText,
}: {
  page: TablePage;
  offsetBase: number;
  order?: TableOrder | null;
  onSort?: (col: string) => void;
  editing?: boolean;
  onCommitCell?: (col: string, value: number | string | null, rowid: number) => void;
  onDeleteRow?: (rowid: number) => void;
  copyText?: (text: string) => Promise<boolean>;
}) {
  const canEdit = editing && onCommitCell != null && page.columns[0]?.name === "rowid";
  const [menu, setMenu] = useState<CellMenuTarget | null>(null);
  const [editReq, setEditReq] = useState<{ row: number; col: string; seq: number } | null>(null);

  const closeMenu = () => setMenu(null);

  const openCellMenu = (
    e: ReactMouseEvent,
    target: Omit<CellMenuTarget, "x" | "y">,
  ) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, ...target });
  };

  async function runCopy(text: string, okMessage: string) {
    if (copyText == null) return;
    const ok = await copyText(text);
    if (ok) toast(okMessage);
    else toast("Copy failed: clipboard unavailable", "danger");
  }

  function onMenuPick(id: CellMenuAction) {
    const target = menu;
    closeMenu();
    if (target == null) return;
    const col = target.col;
    if (id === "edit") {
      if (col != null) {
        setEditReq((cur) => ({ row: target.rowKey, col, seq: (cur?.seq ?? 0) + 1 }));
      }
    } else if (id === "set-null") {
      if (col != null && target.rowid != null) onCommitCell?.(col, null, target.rowid);
    } else if (id === "delete-row") {
      if (target.rowid != null) onDeleteRow?.(target.rowid);
    } else if (id === "copy-value") {
      void runCopy(cellText(target.value), "Copied value");
    } else if (id === "copy-row") {
      const cols = page.columns.map((c) => c.name);
      void runCopy(
        formatMarkdownTable(cols, [page.columns.map((c) => target.row[c.name])]),
        "Copied row as Markdown",
      );
    }
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full min-w-max border-collapse text-left">
        <thead className="sticky top-0 z-10">
          <tr className="bg-surface">
            <th className="w-10 border-b border-line px-3 py-2 text-right font-mono text-[10px] font-medium text-muted/50">
              #
            </th>
            {page.columns.map((col) => {
              const active = order?.col === col.name;
              return (
                <th
                  key={col.name}
                  title={columnTitle(col)}
                  className="whitespace-nowrap border-b border-line px-3 py-2 font-mono text-[11px] font-medium text-muted"
                >
                  {onSort != null ? (
                    <button
                      type="button"
                      onClick={() => onSort(col.name)}
                      className="flex items-center gap-1 text-left hover:text-txt"
                    >
                      <span>{col.name}</span>
                      {col.decl_type && (
                        <span className="font-normal text-muted/45">{col.decl_type}</span>
                      )}
                      {active && order.dir === "asc" && (
                        <ChevronUp size={11} className="shrink-0 text-accent" />
                      )}
                      {active && order.dir === "desc" && (
                        <ChevronDown size={11} className="shrink-0 text-accent" />
                      )}
                      {!active && <ChevronsUpDown size={11} className="shrink-0 text-muted/30" />}
                    </button>
                  ) : (
                    <span className="flex items-center gap-1 text-left">
                      <span>{col.name}</span>
                      {col.decl_type && (
                        <span className="font-normal text-muted/45">{col.decl_type}</span>
                      )}
                    </span>
                  )}
                </th>
              );
            })}
            {canEdit && <th className="w-8 border-b border-line" />}
          </tr>
        </thead>
        <tbody>
          {page.rows.map((row, i) => {
            const rowid = typeof row["rowid"] === "number" ? row["rowid"] : null;
            const rowEditable = canEdit && rowid != null;
            return (
              <tr
                key={offsetBase + i}
                className="border-b border-line/40 transition-colors hover:bg-surface-2/60"
              >
                <td
                  onContextMenu={(e) =>
                    openCellMenu(e, {
                      col: null,
                      value: offsetBase + i + 1,
                      row,
                      rowKey: offsetBase + i,
                      rowid,
                    })
                  }
                  className="px-3 py-1.5 text-right font-mono text-[11px] tabular-nums text-muted/50"
                >
                  {offsetBase + i + 1}
                </td>
                {page.columns.map((col) => {
                  const editable = rowEditable && col.name !== "rowid";
                  return (
                    <td
                      key={col.name}
                      onContextMenu={(e) =>
                        openCellMenu(e, {
                          col: col.name,
                          value: row[col.name],
                          row,
                          rowKey: offsetBase + i,
                          rowid,
                        })
                      }
                      className={clsx(
                        "max-w-[320px] px-3 py-1.5 align-top text-[12px]",
                        editable && "cursor-text hover:bg-surface-2",
                      )}
                    >
                      {editable ? (
                        <EditableCell
                          value={row[col.name]}
                          onCommit={(v) => rowid != null && onCommitCell?.(col.name, v, rowid)}
                          editSignal={
                            editReq != null && editReq.row === offsetBase + i && editReq.col === col.name
                              ? editReq.seq
                              : 0
                          }
                        />
                      ) : (
                        <Cell value={row[col.name]} />
                      )}
                    </td>
                  );
                })}
                {canEdit && (
                  <td className="px-1 py-1.5 text-center align-top">
                    {rowEditable && (
                      <button
                        type="button"
                        onClick={() => rowid != null && onDeleteRow?.(rowid)}
                        title={`DELETE FROM this table WHERE rowid = ${rowid}`}
                        className="flex h-5 w-5 items-center justify-center rounded-sm text-muted/60 hover:bg-danger/10 hover:text-danger"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {menu != null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={cellMenuItems({
            editable: canEdit && menu.col != null && menu.col !== "rowid" && menu.rowid != null,
            isRowid: menu.col === "rowid" || menu.col == null,
          })}
          onPick={onMenuPick}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
