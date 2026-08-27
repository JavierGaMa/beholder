import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useTraffic } from "../../store/traffic";
import { formatTime } from "../../lib/format";
import { EmptyState } from "../../components/ui/primitives";

export function WebSocketsView() {
  const connections = useTraffic((s) => s.wsConnections);
  const [selected, setSelected] = useState<number | null>(null);

  const conns = useMemo(() => Array.from(connections.values()), [connections]);
  const active = selected != null ? connections.get(selected) ?? null : conns[0] ?? null;

  return (
    <div className="flex h-full">
      <div className="flex w-72 shrink-0 flex-col border-r border-line">
        <p className="border-b border-line px-3 py-2 text-[10px] uppercase tracking-wider text-muted">
          Connections ({conns.length})
        </p>
        <div className="flex-1 overflow-auto">
          {conns.length === 0 ? (
            <EmptyState title="No WebSocket connections" hint="Frames appear when your app connects" />
          ) : (
            conns.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelected(c.id)}
                className={clsx(
                  "block w-full border-b border-line/50 px-3 py-2 text-left",
                  active?.id === c.id ? "bg-surface-2" : "hover:bg-surface/60",
                )}
              >
                <span className="block truncate font-mono text-[12px] text-txt/90">{c.url}</span>
                <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                  {c.closed ? "closed" : "open"} · {c.frames.length} frames
                </span>
              </button>
            ))
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {active ? <FrameTimeline key={active.id} connId={active.id} /> : <EmptyState title="No connection selected" />}
      </div>
    </div>
  );
}

function FrameTimeline({ connId }: { connId: number }) {
  const frames = useTraffic((s) => s.wsConnections.get(connId)?.frames ?? []);
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: frames.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 30,
    overscan: 15,
  });

  return (
    <div ref={parentRef} className="flex-1 overflow-auto">
      {frames.length === 0 ? (
        <EmptyState title="No frames yet" />
      ) : (
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const f = frames[vi.index];
            return (
              <div
                key={f.seq}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: vi.size,
                  transform: `translateY(${vi.start}px)`,
                }}
                className="flex items-start gap-2 border-b border-line/50 px-3 py-1 font-mono text-[12px]"
              >
                <span className="w-16 shrink-0 text-muted/70">{formatTime(f.at)}</span>
                <span
                  className={clsx(
                    "flex w-5 shrink-0 items-center justify-center",
                    f.direction === "Sent" ? "text-accent" : "text-ok",
                  )}
                >
                  {f.direction === "Sent" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                </span>
                <span className="min-w-0 flex-1 truncate text-txt/90">
                  {f.payload.is_binary ? `(${f.payload.size} bytes binary)` : f.payload.text}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
