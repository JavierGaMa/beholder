import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FileDown } from "lucide-react";
import { useTraffic } from "../../store/traffic";
import { invoke } from "../../lib/tauri";
import { EmptyState, IconButton } from "../../components/ui/primitives";
import { matchFilters, type Filters } from "./filters";
import { FilterBar } from "./FilterBar";
import { RequestRow } from "./RequestRow";
import { DetailPane } from "./DetailPane";

export function RequestsView() {
  const exchanges = useTraffic((s) => s.exchanges);
  const order = useTraffic((s) => s.order);
  const [filters, setFilters] = useState<Filters>({ text: "", status: "all", method: "" });
  const [selected, setSelected] = useState<number | null>(null);

  const rows = useMemo(() => {
    const all = order.map((id) => exchanges.get(id)).filter((e): e is NonNullable<typeof e> => Boolean(e));
    return all.filter((ex) => matchFilters(ex, filters));
  }, [order, exchanges, filters]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 35,
    overscan: 20,
  });

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
      <FilterBar filters={filters} onChange={setFilters} />
      <div className="relative flex flex-1 gap-0 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-line/50 px-3 py-1 text-[10px] uppercase tracking-wider text-muted/70">
            <span>{rows.length} requests</span>
            <IconButton title="Export session as HAR" onClick={exportHar}>
              <FileDown size={13} />
            </IconButton>
          </div>
          <div ref={parentRef} className="flex-1 overflow-auto">
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
        </div>
        {selectedEx && <DetailPane ex={selectedEx} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}
