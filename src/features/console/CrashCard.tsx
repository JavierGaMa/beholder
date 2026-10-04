import { memo, useState } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronRight, Copy } from "lucide-react";
import { Badge } from "../../components/ui/primitives";
import { Button } from "../../components/ui/Button";
import type { LogLine } from "../../store/console-types";
import { formatLogLine, timeOf } from "./rows";

export const CrashCard = memo(function CrashCard({
  line,
  repeatCount,
  onCopy,
}: {
  line: LogLine;
  repeatCount: number;
  onCopy?: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anr = line.message.startsWith("ANR in ");
  const summary = line.message.split("\n", 1)[0] ?? "";
  return (
    <div
      className={clsx(
        "border-b border-line/40 border-l-2 px-3 py-1.5 font-mono text-[length:var(--mono-size,12px)] leading-5",
        anr ? "border-l-warn bg-warn/10" : "border-l-danger bg-danger/10",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="w-[86px] shrink-0 tabular-nums text-muted/80">{timeOf(line.ts_ms)}</span>
        <Badge tone={anr ? "warn" : "danger"}>{anr ? "ANR" : "FATAL EXCEPTION"}</Badge>
        <span className="min-w-0 flex-1 truncate text-txt/90" title={summary}>
          {summary}
        </span>
        {repeatCount > 1 && (
          <span className="rounded border border-line px-1 text-[10px] leading-4 text-muted">
            × {repeatCount}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onCopy?.(formatLogLine(line))}
          aria-label="Copy crash details"
          title="Copy crash details"
        >
          <Copy size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOpen((o) => !o)}
          title={open ? "Collapse stack" : "Expand stack"}
          aria-label={open ? "Collapse stack" : "Expand stack"}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </Button>
      </div>
      {open && <pre className="mt-1 whitespace-pre-wrap break-all text-txt/80">{line.message}</pre>}
    </div>
  );
});
