import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FileDown, ArrowDown, PanelRight } from "lucide-react";
import { useTraffic } from "../../store/traffic";
import { invoke } from "../../lib/tauri";
import { loadFilters, loadFollow, loadSlowMs, saveFilters, saveFollow } from "../../lib/prefs";
import { EmptyState, IconButton } from "../../components/ui/primitives";
import { matchFilters, type Filters } from "./filters";
import { RequestRow } from "./RequestRow";
import { DetailPane } from "./DetailPane";
import { FilterBar, type DomainChip } from "./FilterBar";

export function RequestsView() {
  const exchanges = useTraffic((s) => s.exchanges);
  const order = useTraffic((s) => s.order);
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [selected, setSelected] = useState<number | null>(null);
  const [follow, setFollow] = useState(loadFollow);
  const [newCount, setNewCount] = useState(0);
  const [flashIds, setFlashIds] = useState<Set<number>>(new Set());
  const [filtersCollapsed, setFiltersCollapsed] = useState(
    () => localStorage.getItem("beholder.filtersOpen") === "false",
  );
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const prevOrderLen = useRef(order.length);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slowMs = loadSlowMs();

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

  const rows = useMemo(() => {
    const all = order.map((id) => exchanges.get(id)).filter((e): e is NonNullable<typeof e> => Boolean(e));
    return all.filter((ex) => matchFilters(ex, filters, slowMs));
  }, [order, exchanges, filters, slowMs]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 35,
    overscan: 20,
  });

  useEffect(() => {
    saveFilters(filters);
  }, [filters]);

  useEffect(() => {
    saveFollow(follow);
  }, [follow]);

  const delta = order.length - prevOrderLen.current;
  const newIds = delta > 0 ? order.slice(prevOrderLen.current) : [];
  prevOrderLen.current = order.length;

  useEffect(() => {
    if (newIds.length === 0) return;
    if (follow) {
      setNewCount(0);
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(rows.length - 1, { align: "end" });
      });
    } else {
      setNewCount((c) => c + newIds.length);
    }
    setFlashIds((prev) => {
      const next = new Set(prev);
      for (const id of newIds) next.add(id);
      return next;
    });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashIds(new Set()), 800);
  }, [order.length]);

  function onScroll() {
    const el = parentRef.current;
    if (!el || !follow) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (!nearBottom) setFollow(false);
  }

  function jumpToLatest() {
    setFollow(true);
    setNewCount(0);
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(rows.length - 1, { align: "end" });
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
      if (e.key === "Escape") {
        if (typing) (target as HTMLInputElement).blur();
        else setSelected(null);
        return;
      }
      if (typing) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (rows.length === 0) return;
      e.preventDefault();
      const currentIdx = selected != null ? rows.findIndex((r) => r.id === selected) : -1;
      let nextIdx: number;
      if (currentIdx === -1) nextIdx = e.key === "ArrowDown" ? 0 : rows.length - 1;
      else nextIdx = e.key === "ArrowDown" ? Math.min(currentIdx + 1, rows.length - 1) : Math.max(currentIdx - 1, 0);
      const next = rows[nextIdx];
      if (next) {
        setSelected(next.id);
        virtualizer.scrollToIndex(nextIdx, { align: "auto" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, selected, virtualizer]);

  const selectedEx = selected != null ? exchanges.get(selected) ?? null : null;

  async function exportHar() {
    const all = order
      .map((id) => exchanges.get(id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e));
    const har = await invoke<string>("export_har", { exchanges: all });
    const blob = new Blob([har], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `beholder-${new Date().toISOString().replace(/[:.]/g, "-")}.har`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full flex-col">
      <FilterBar
        filters={filters}
        onChange={setFilters}
        domains={domains}
        follow={follow}
        onFollowChange={(v) => {
          setFollow(v);
          if (!v) setNewCount(0);
        }}
        searchRef={searchRef}
        collapsed={filtersCollapsed}
        onToggleCollapsed={() => {
          setFiltersCollapsed((c) => {
            localStorage.setItem("beholder.filtersOpen", String(!c));
            return !c;
          });
        }}
      />
      <div className="relative flex flex-1 gap-0 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-line/50 px-3 py-1 text-[10px] uppercase tracking-wider text-muted/70">
            <span>
              {rows.length} requests{filters.includeDomains.length > 0 ? ` · ${filters.includeDomains.length} domains included` : ""}
            </span>
            <IconButton title="Export session as HAR" onClick={exportHar}>
              <FileDown size={13} />
            </IconButton>
          </div>
          <div className="relative flex-1">
            <div ref={parentRef} onScroll={onScroll} className="h-full overflow-auto">
              {rows.length === 0 ? (
                <EmptyState
                  title="No requests captured"
                  hint="Start capture in Setup, then use your app on the emulator"
                />
              ) : (
                <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                  {virtualizer.getVirtualItems().map((vi) => {
                    const ex = rows[vi.index];
                    return (
                      <RequestRow
                        key={ex.id}
                        ex={ex}
                        selected={ex.id === selected}
                        flash={flashIds.has(ex.id)}
                        slowMs={slowMs}
                        onSelect={() => setSelected(ex.id)}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: vi.size,
                          transform: `translateY(${vi.start}px)`,
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </div>
            {!follow && newCount > 0 && (
              <button
                type="button"
                onClick={jumpToLatest}
                className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-accent bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-accent shadow-lg"
              >
                <ArrowDown size={12} /> {newCount} new requests
              </button>
            )}
          </div>
        </div>
        {selectedEx && !detailCollapsed && (
          <DetailPane
            ex={selectedEx}
            onClose={() => setSelected(null)}
            onCollapse={() => setDetailCollapsed(true)}
          />
        )}
        {selectedEx && detailCollapsed && (
          <button
            type="button"
            title="Show detail"
            onClick={() => setDetailCollapsed(false)}
            className="flex w-7 shrink-0 flex-col items-center justify-center gap-2 border-l border-line bg-surface text-muted hover:text-accent"
          >
            <PanelRight size={14} className="rotate-180" />
            <span className="text-[10px] [writing-mode:vertical-rl]">detail</span>
          </button>
        )}
      </div>
    </div>
  );
}
