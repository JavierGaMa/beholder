import clsx from "clsx";
import { Pin, PinOff } from "lucide-react";
import type { Filters } from "./filters";
import { IconButton } from "../../components/ui/primitives";
import { Trash2 } from "lucide-react";
import { useTraffic } from "../../store/traffic";

const STATUS_OPTIONS: Filters["status"][] = ["all", "2xx", "3xx", "4xx", "5xx"];

export interface DomainChip {
  host: string;
  count: number;
}

export function FilterBar({
  filters,
  onChange,
  domains,
  follow,
  onFollowChange,
  searchRef,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  domains: DomainChip[];
  follow: boolean;
  onFollowChange: (v: boolean) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const clear = useTraffic((s) => s.clear);

  function toggleDomain(host: string, mode: "include" | "exclude") {
    const list = mode === "include" ? filters.includeDomains : filters.excludeDomains;
    const other = mode === "include" ? filters.excludeDomains : filters.includeDomains;
    const next = list.includes(host) ? list.filter((h) => h !== host) : [...list, host];
    const patch =
      mode === "include"
        ? { includeDomains: next, excludeDomains: other.filter((h) => h !== host) }
        : { excludeDomains: next, includeDomains: other.filter((h) => h !== host) };
    onChange({ ...filters, ...patch });
  }

  const chipFor = (host: string) =>
    filters.includeDomains.includes(host)
      ? "include"
      : filters.excludeDomains.includes(host)
        ? "exclude"
        : "neutral";

  return (
    <div className="flex flex-col gap-2 border-b border-line bg-surface px-3 py-2">
      <div className="flex items-center gap-2">
        <input
          ref={searchRef}
          value={filters.text}
          onChange={(e) => onChange({ ...filters, text: e.target.value })}
          placeholder="Filter by host, path or content"
          className="h-7 w-72 rounded-md border border-line bg-bg px-2 font-mono text-[12px] text-txt placeholder:text-muted/60 focus:border-accent focus:outline-none"
        />
        <label className="flex cursor-pointer items-center gap-1 text-[11px] text-muted">
          <input
            type="checkbox"
            checked={filters.inBodies}
            onChange={(e) => onChange({ ...filters, inBodies: e.target.checked })}
            className="h-3 w-3 accent-[var(--accent)]"
          />
          content
        </label>
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
        <button
          type="button"
          onClick={() => onChange({ ...filters, failuresOnly: !filters.failuresOnly })}
          className={clsx(
            "h-7 rounded-md border px-2 text-[11px] font-medium transition-colors",
            filters.failuresOnly ? "border-danger bg-danger/10 text-danger" : "border-line text-muted hover:text-txt",
          )}
        >
          failures
        </button>
        <button
          type="button"
          onClick={() => onChange({ ...filters, slowOnly: !filters.slowOnly })}
          className={clsx(
            "h-7 rounded-md border px-2 text-[11px] font-medium transition-colors",
            filters.slowOnly ? "border-warn bg-warn/10 text-warn" : "border-line text-muted hover:text-txt",
          )}
        >
          slow
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => onFollowChange(!follow)}
          title="Follow newest requests (pauses when you scroll up)"
          className={clsx(
            "flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors",
            follow ? "border-accent bg-accent/10 text-accent" : "border-line text-muted hover:text-txt",
          )}
        >
          {follow ? <Pin size={12} /> : <PinOff size={12} />} follow
        </button>
        <IconButton title="Clear all captured traffic" onClick={clear}>
          <Trash2 size={14} />
        </IconButton>
      </div>
      {domains.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {domains.map((d) => {
            const state = chipFor(d.host);
            return (
              <button
                key={d.host}
                type="button"
                onClick={(e) => toggleDomain(d.host, e.altKey ? "exclude" : "include")}
                title={`Click: only this domain · ⌥click: hide this domain (${d.count} requests)`}
                className={clsx(
                  "rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors",
                  state === "include" && "border-accent bg-accent/10 text-accent",
                  state === "exclude" && "border-danger bg-danger/10 text-danger line-through",
                  state === "neutral" && "border-line text-muted hover:border-muted/50 hover:text-txt",
                )}
              >
                {d.host}
                <span className="ml-1 opacity-60">{d.count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
