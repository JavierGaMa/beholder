import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import type { TableOrder, TablePage } from "../../queries/databases";
import { classifyCell, columnTitle } from "./dbdisplay";

function Cell({ value }: { value: unknown }) {
  const cell = classifyCell(value);
  if (cell.kind === "null") {
    return (
      <span className="block max-w-[320px] truncate italic text-muted/45" title="NULL">
        null
      </span>
    );
  }
  if (cell.kind === "number") {
    return (
      <span className="block max-w-[320px] truncate font-mono tabular-nums text-txt/90" title={cell.text}>
        {cell.text}
      </span>
    );
  }
  if (cell.kind === "blob") {
    return (
      <span className="block max-w-[320px] truncate font-mono text-muted/60" title={cell.text}>
        {cell.text}
      </span>
    );
  }
  return (
    <span className="block max-w-[320px] truncate text-txt/90" title={cell.text}>
      {cell.text}
    </span>
  );
}

export function TableGrid({
  page,
  offsetBase,
  order,
  onSort,
}: {
  page: TablePage;
  offsetBase: number;
  order: TableOrder | null;
  onSort: (col: string) => void;
}) {
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
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {page.rows.map((row, i) => (
            <tr key={offsetBase + i} className="border-b border-line/40 transition-colors hover:bg-surface-2/60">
              <td className="px-3 py-1.5 text-right font-mono text-[11px] tabular-nums text-muted/50">
                {offsetBase + i + 1}
              </td>
              {page.columns.map((col) => (
                <td key={col.name} className="max-w-[320px] px-3 py-1.5 align-top text-[12px]">
                  <Cell value={row[col.name]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
