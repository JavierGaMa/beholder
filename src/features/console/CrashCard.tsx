import { memo, useState } from "react";
import { ChevronDown, ChevronRight, Copy } from "lucide-react";
import { Badge } from "../../components/ui/primitives";
import { Button } from "../../components/ui/Button";
import type { LogLine } from "../../store/console-types";
import { formatLogLine, timeOf } from "./rows";
import { crashSummary } from "./toolbar";

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
  const summary = crashSummary(line.message);
  return (
    <div className="px-3 py-1">
      <div className="rounded-[var(--radius-md)] bg-danger/9 px-3 py-2 font-mono text-[length:var(--mono-size,12px)] leading-5 ring-1 ring-danger/35 ring-inset">
        <div className="flex items-center gap-3">
          <span className="w-[86px] shrink-0 tabular-nums text-muted/70">{timeOf(line.ts_ms)}</span>
          <Badge tone={anr ? "warn" : "danger"} className="shrink-0 font-semibold tracking-wide">
            {anr ? "ANR" : "FATAL EXCEPTION"}
          </Badge>
          <span className="min-w-0 flex-1 truncate text-txt" title={summary}>
            {summary}
          </span>
          {repeatCount > 1 && (
            <span className="shrink-0 rounded-[var(--radius-sm)] bg-surface-2 px-1.5 text-[10px] leading-4 text-muted">
              × {repeatCount}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={Copy}
            onClick={() => onCopy?.(formatLogLine(line))}
            aria-label="Copy crash details"
            title="Copy crash details"
            className="shrink-0"
          >
            Copy
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={open ? ChevronDown : ChevronRight}
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            title={open ? "Collapse stack" : "Expand stack"}
            className="shrink-0"
          >
            {open ? "Hide stack" : "Show stack"}
          </Button>
        </div>
        {open && <pre className="mt-2 whitespace-pre-wrap break-all text-txt/80">{line.message}</pre>}
      </div>
    </div>
  );
});
