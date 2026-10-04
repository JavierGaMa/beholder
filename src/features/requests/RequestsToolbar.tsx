import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Pin, PinOff, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Checkbox } from "../../components/ui/Checkbox";
import { Chip } from "../../components/ui/Chip";
import { Input } from "../../components/ui/Input";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { Tooltip } from "../../components/ui/Tooltip";
import { useDropdownPosition } from "../../components/ui/popover";
import { Badge, IconButton } from "../../components/ui/primitives";
import { useTraffic } from "../../store/traffic";
import { activeFilterCount, type Filters } from "./filters";

const STATUS_OPTIONS: { value: Filters["status"]; label: string }[] = [
  { value: "all", label: "all" },
  { value: "2xx", label: "2xx" },
  { value: "3xx", label: "3xx" },
  { value: "4xx", label: "4xx" },
  { value: "5xx", label: "5xx" },
];

export interface DomainChip {
  host: string;
  count: number;
}

export function RequestsToolbar({
  filters,
  onChange,
  follow,
  onFollowChange,
  searchRef,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  follow: boolean;
  onFollowChange: (v: boolean) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const order = useTraffic((s) => s.order);
  const exchanges = useTraffic((s) => s.exchanges);
  const clear = useTraffic((s) => s.clear);
  const [open, setOpen] = useState(false);
  const { anchorRef, menuRef, style } = useDropdownPosition(open, { width: 320, estHeight: 330 });

  const domains = useMemo<DomainChip[]>(() => {
    const counts = new Map<string, number>();
    for (const id of order) {
      const ex = exchanges.get(id);
      if (!ex) continue;
      counts.set(ex.request.host, (counts.get(ex.request.host) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([host, count]) => ({ host, count }));
  }, [order, exchanges]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, menuRef, anchorRef]);

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

  const activeCount = activeFilterCount(filters);

  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <div className="min-w-28 max-w-md flex-1">
        <Input
          ref={searchRef}
          mono
          value={filters.text}
          onChange={(e) => onChange({ ...filters, text: e.target.value })}
          placeholder="Filter by host, path or content"
          aria-label="Search requests"
        />
      </div>
      <Tooltip label="Filters">
        <Button
          ref={anchorRef}
          variant="ghost"
          className="shrink-0 whitespace-nowrap"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Filters"
        >
          <SlidersHorizontal size={14} className="shrink-0 md:hidden" />
          <span className="hidden md:inline">Filters</span>
          {activeCount > 0 && <Badge tone="accent">{activeCount}</Badge>}
        </Button>
      </Tooltip>
      <span className="hidden shrink-0 md:inline-flex">
        <Chip
          selected={follow}
          onClick={() => onFollowChange(!follow)}
          title="Follow newest requests (pauses when you scroll up)"
        >
          {follow ? <Pin size={12} /> : <PinOff size={12} />} follow
        </Chip>
      </span>
      <IconButton title="Clear all captured traffic" onClick={clear} className="shrink-0">
        <Trash2 size={14} />
      </IconButton>
      {open && (
        <div
          ref={menuRef}
          style={style}
          role="group"
          aria-label="Request filters"
          className="anim-pop-in fixed z-50 flex flex-col gap-3 overflow-y-auto rounded-[var(--radius-md)] border border-line bg-surface-2 p-3 text-left shadow-[var(--shadow-3)] outline-none"
        >
          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted/70">Status</p>
            <SegmentedControl
              options={STATUS_OPTIONS}
              value={filters.status}
              onChange={(status) => onChange({ ...filters, status })}
              ariaLabel="Status filter"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted/70">Method</p>
            <Input
              mono
              className="uppercase"
              placeholder="Method"
              value={filters.method}
              onChange={(e) => onChange({ ...filters, method: e.target.value })}
              aria-label="HTTP method filter"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted/70">Options</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <Checkbox
                label="failures"
                checked={filters.failuresOnly}
                onChange={(e) => onChange({ ...filters, failuresOnly: e.target.checked })}
              />
              <Checkbox
                label="slow"
                checked={filters.slowOnly}
                onChange={(e) => onChange({ ...filters, slowOnly: e.target.checked })}
              />
              <Checkbox
                label="content"
                checked={filters.inBodies}
                onChange={(e) => onChange({ ...filters, inBodies: e.target.checked })}
              />
            </div>
          </div>
          {domains.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted/70">Domains</p>
              <div className="flex flex-wrap gap-1">
                {domains.map((d) => {
                  const state = chipFor(d.host);
                  return (
                    <Chip
                      key={d.host}
                      count={d.count}
                      selected={state === "include"}
                      className={clsx(
                        state === "exclude" && "border-danger bg-danger/10 text-danger line-through",
                      )}
                      onClick={(e) => toggleDomain(d.host, e.altKey ? "exclude" : "include")}
                      title={`Click: only this domain · Alt+click: hide this domain (${d.count} requests)`}
                    >
                      {d.host}
                    </Chip>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
