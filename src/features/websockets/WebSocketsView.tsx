import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { ArrowDown, ArrowUp, Check, Copy } from "lucide-react";
import { useTraffic, type WsConnection, type WsFrame } from "../../store/traffic";
import { formatBytes, formatTime } from "../../lib/format";
import { EmptyState } from "../../components/ui/primitives";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import {
  connectionParts,
  filterFrames,
  formatDuration,
  formatPayload,
  frameCounts,
  highlightJson,
  type DirectionFilter,
  type JsonTokenKind,
} from "./frames";

const FRAME_ROW_H = 32;
const EMPTY_FRAMES: WsFrame[] = [];

export function WebSocketsView() {
  const connections = useTraffic((s) => s.wsConnections);
  const [selected, setSelected] = useState<number | null>(null);

  const conns = useMemo(() => Array.from(connections.values()), [connections]);
  const active = selected != null ? connections.get(selected) ?? null : conns[0] ?? null;

  return (
    <div className="grid h-full min-h-0 grid-cols-[300px_minmax(0,1fr)_400px] gap-2">
      <ConnectionList conns={conns} activeId={active?.id ?? null} onSelect={setSelected} />
      {active ? (
        <FramesWorkspace key={active.id} connId={active.id} />
      ) : (
        <>
          <section className="panel flex flex-col">
            <EmptyState title="No connection selected" />
          </section>
          <aside className="panel" />
        </>
      )}
    </div>
  );
}

function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

function ConnectionList({
  conns,
  activeId,
  onSelect,
}: {
  conns: WsConnection[];
  activeId: number | null;
  onSelect: (id: number) => void;
}) {
  const now = useNow(conns.some((c) => !c.closed));
  return (
    <section aria-label="Connections" className="panel flex flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 px-4">
        <h2 className="text-[13px] font-semibold text-txt">Connections</h2>
        <span className="font-mono text-[11px] tabular-nums text-muted">{conns.length}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-1.5">
        {conns.length === 0 ? (
          <EmptyState title="No WebSocket connections" hint="Frames appear when your app connects" />
        ) : (
          conns.map((c) => {
            const { host, path } = connectionParts(c.url);
            const isActive = activeId === c.id;
            const status = c.closed ? "closed" : `open for ${formatDuration(now - c.openedAt)}`;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect(c.id)}
                title={c.url}
                className={clsx(
                  "focus-ring flex h-[52px] w-full items-center gap-2 rounded-[var(--radius-md)] px-2.5 text-left transition-colors [transition-duration:var(--dur-fast)]",
                  isActive ? "bg-accent/12 ring-1 ring-accent/40 ring-inset" : "hover:bg-surface-2",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[12px] font-semibold text-txt">{host}</span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-muted">
                    {path !== "" ? `${path}, ${status}` : status}
                  </span>
                </span>
                <span
                  className={clsx(
                    "shrink-0 rounded-[var(--radius-sm)] px-1.5 py-px font-mono text-[11px] tabular-nums",
                    c.closed ? "bg-surface-2 text-muted" : "bg-accent/15 text-accent",
                  )}
                >
                  {c.frames.length}
                </span>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

function FramesWorkspace({ connId }: { connId: number }) {
  const all = useTraffic((s) => s.wsConnections.get(connId)?.frames ?? EMPTY_FRAMES);
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<DirectionFilter>("all");
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);

  const visible = filterFrames(all, query, direction);
  const counts = frameCounts(all, query);
  const selectedIndex = selectedSeq == null ? -1 : all.findIndex((f) => f.seq === selectedSeq);
  const selectedFrame = selectedIndex >= 0 ? all[selectedIndex] : null;

  return (
    <>
      <section aria-label="Frames" className="panel flex flex-col">
        <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-3">
          <div className="min-w-0 flex-1">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter frames"
              aria-label="Filter frames"
            />
          </div>
          <SegmentedControl
            ariaLabel="Frame direction"
            value={direction}
            onChange={setDirection}
            options={[
              { value: "all", label: `All ${counts.all}` },
              { value: "sent", label: `Sent ${counts.sent}` },
              { value: "received", label: `Received ${counts.received}` },
            ]}
          />
        </div>
        <FrameList
          frames={visible}
          total={all.length}
          selectedSeq={selectedFrame?.seq ?? null}
          onSelect={setSelectedSeq}
        />
      </section>
      <FrameDetail frame={selectedFrame} index={selectedIndex} total={all.length} />
    </>
  );
}

const GRID = "grid grid-cols-[96px_20px_64px_minmax(0,1fr)] items-center gap-2";

function FrameList({
  frames,
  total,
  selectedSeq,
  onSelect,
}: {
  frames: WsFrame[];
  total: number;
  selectedSeq: number | null;
  onSelect: (seq: number) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: frames.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => FRAME_ROW_H,
    overscan: 15,
  });

  if (total === 0) {
    return (
      <div className="min-h-0 flex-1">
        <EmptyState title="No frames yet" />
      </div>
    );
  }

  return (
    <>
      <div className={clsx(GRID, "shrink-0 px-5 pb-1 pt-1 text-[11px] text-muted")}>
        <span>Time</span>
        <span />
        <span>Size</span>
        <span>Payload</span>
      </div>
      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto px-1.5 pb-1.5">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const f = frames[vi.index];
            const isSelected = f.seq === selectedSeq;
            const sent = f.direction === "Sent";
            return (
              <button
                key={f.seq}
                type="button"
                onClick={() => onSelect(f.seq)}
                aria-pressed={isSelected}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: vi.size,
                  transform: `translateY(${vi.start}px)`,
                }}
                className={clsx(
                  GRID,
                  "focus-ring rounded-[var(--radius-md)] px-3.5 text-left font-mono text-[length:var(--mono-size,12px)] transition-colors [transition-duration:var(--dur-fast)]",
                  isSelected ? "bg-accent/12 ring-1 ring-accent/40 ring-inset" : "hover:bg-surface-2",
                )}
              >
                <span className="truncate tabular-nums text-muted">{formatTime(f.at)}</span>
                <span
                  aria-label={f.direction}
                  className={clsx("flex items-center justify-center", sent ? "text-accent" : "text-muted")}
                >
                  {sent ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                </span>
                <span className="truncate tabular-nums text-muted">{formatBytes(f.payload.size)}</span>
                <span className="min-w-0 truncate text-txt/90">
                  {f.payload.is_binary ? `(${f.payload.size} bytes binary)` : f.payload.text}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

const TOKEN_CLASS: Record<JsonTokenKind, string> = {
  key: "text-muted",
  string: "text-accent",
  number: "text-warn",
  literal: "italic text-muted",
  punct: "text-txt/80",
};

function FrameDetail({ frame, index, total }: { frame: WsFrame | null; index: number; total: number }) {
  const [copied, setCopied] = useState(false);
  const formatted = useMemo(() => (frame ? formatPayload(frame.payload) : null), [frame]);
  const tokens = useMemo(
    () => (formatted?.kind === "json" ? highlightJson(formatted.text) : null),
    [formatted],
  );

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  if (frame == null || formatted == null) {
    return (
      <aside aria-label="Frame detail" className="panel flex flex-col">
        <EmptyState title="No frame selected" hint="Click a frame to see its payload" />
      </aside>
    );
  }

  async function copy() {
    if (formatted == null || formatted.kind === "binary") return;
    await navigator.clipboard.writeText(formatted.text);
    setCopied(true);
  }

  const sent = frame.direction === "Sent";
  return (
    <aside aria-label="Frame detail" className="panel flex flex-col">
      <header className="flex shrink-0 flex-col gap-3 px-4 pb-3 pt-3">
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              "rounded-[var(--radius-sm)] px-1.5 py-px font-mono text-[11px]",
              sent ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted",
            )}
          >
            {frame.direction}
          </span>
          <span className="font-mono text-[12px] tabular-nums text-muted">{formatTime(frame.at)}</span>
          <span className="flex-1" />
          <Button
            size="sm"
            variant="subtle"
            onClick={() => void copy()}
            disabled={formatted.kind === "binary"}
            aria-label="Copy payload"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <dl className="grid grid-cols-3 divide-x divide-line overflow-hidden rounded-[var(--radius-md)] bg-surface-2">
          <Fact label="Size" value={formatBytes(frame.payload.size)} />
          <Fact label="Type" value={frame.payload.is_binary ? "binary" : "text"} />
          <Fact label="Frame" value={`${index + 1} of ${total}`} />
        </dl>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        <pre className="whitespace-pre-wrap break-all rounded-[var(--radius-md)] bg-surface-2 p-3 font-mono text-[length:var(--mono-size,12px)] leading-5 text-txt/90">
          {tokens != null
            ? tokens.map((t, i) => (
                <span key={i} className={TOKEN_CLASS[t.kind]}>
                  {t.text}
                </span>
              ))
            : formatted.kind === "binary"
              ? <span className="text-muted">{formatted.text}</span>
              : formatted.text}
        </pre>
        {frame.payload.truncated && (
          <p className="mt-2 text-[11px] text-muted">Payload truncated by the proxy capture limit.</p>
        )}
      </div>
    </aside>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-3 py-2">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="truncate font-mono text-[12px] tabular-nums text-txt">{value}</dd>
    </div>
  );
}
