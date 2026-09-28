import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronUp, ChevronsUpDown, Trash2 } from "lucide-react";
import type { TableOrder, TablePage } from "../../queries/databases";
import { classifyCell, columnTitle } from "./dbdisplay";
import { cellValueFromInput } from "./writes";

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
}: {
  value: unknown;
  onCommit: (next: number | string | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const settled = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (draft != null) inputRef.current?.focus();
  }, [draft]);

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

export function TableGrid({
  page,
  offsetBase,
  order = null,
  onSort,
  editing = false,
  onCommitCell,
  onDeleteRow,
}: {
  page: TablePage;
  offsetBase: number;
  order?: TableOrder | null;
  onSort?: (col: string) => void;
  editing?: boolean;
  onCommitCell?: (col: string, value: number | string | null, rowid: number) => void;
  onDeleteRow?: (rowid: number) => void;
}) {
  const canEdit = editing && onCommitCell != null && page.columns[0]?.name === "rowid";
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
                <td className="px-3 py-1.5 text-right font-mono text-[11px] tabular-nums text-muted/50">
                  {offsetBase + i + 1}
                </td>
                {page.columns.map((col) => {
                  const editable = rowEditable && col.name !== "rowid";
                  return (
                    <td
                      key={col.name}
                      className={clsx(
                        "max-w-[320px] px-3 py-1.5 align-top text-[12px]",
                        editable && "cursor-text hover:bg-surface-2",
                      )}
                    >
                      {editable ? (
                        <EditableCell
                          value={row[col.name]}
                          onCommit={(v) => rowid != null && onCommitCell?.(col.name, v, rowid)}
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
    </div>
  );
}
