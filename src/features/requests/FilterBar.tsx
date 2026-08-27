import clsx from "clsx";
import type { Filters } from "./filters";
import { IconButton } from "../../components/ui/primitives";
import { Trash2 } from "lucide-react";
import { useTraffic } from "../../store/traffic";

const STATUS_OPTIONS: Filters["status"][] = ["all", "2xx", "3xx", "4xx", "5xx"];

export function FilterBar({
  filters,
  onChange,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
}) {
  const clear = useTraffic((s) => s.clear);
  return (
    <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2">
      <input
        value={filters.text}
        onChange={(e) => onChange({ ...filters, text: e.target.value })}
        placeholder="Filter by host or path"
        className="h-7 w-64 rounded-md border border-line bg-bg px-2 font-mono text-[12px] text-txt placeholder:text-muted/60 focus:border-accent focus:outline-none"
      />
      <input
        value={filters.method}
        onChange={(e) => onChange({ ...filters, method: e.target.value })}
        placeholder="Method"
        className="h-7 w-20 rounded-md border border-line bg-bg px-2 font-mono text-[12px] uppercase text-txt placeholder:text-muted/60 focus:border-accent focus:outline-none"
      />
      <div className="flex overflow-hidden rounded-md border border-line">
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange({ ...filters, status: s })}
            className={clsx(
              "h-7 px-2 text-[11px] font-medium transition-colors",
              filters.status === s ? "bg-accent text-accent-fg" : "bg-bg text-muted hover:text-txt",
            )}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="flex-1" />
      <IconButton title="Clear all captured traffic" onClick={clear}>
        <Trash2 size={14} />
      </IconButton>
    </div>
  );
}
