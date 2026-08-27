import { useState } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronRight, Copy } from "lucide-react";

function isPrimitive(v: unknown): boolean {
  return v === null || ["string", "number", "boolean", "undefined"].includes(typeof v);
}

function formatValue(v: unknown): { text: string; cls: string } {
  if (v === null) return { text: "null", cls: "text-warn" };
  if (typeof v === "string") return { text: `"${v}"`, cls: "text-ok" };
  if (typeof v === "number") return { text: String(v), cls: "text-accent" };
  if (typeof v === "boolean") return { text: String(v), cls: "text-warn" };
  return { text: "", cls: "" };
}

function nodeSummary(v: unknown): string {
  if (Array.isArray(v)) return `${v.length} items`;
  if (typeof v === "object" && v !== null) return `${Object.keys(v).length} keys`;
  return "";
}

function Node({
  name,
  value,
  path,
  depth,
  onCopyPath,
  defaultOpen,
}: {
  name: string;
  value: unknown;
  path: string;
  depth: number;
  onCopyPath: (p: string) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isObj = !isPrimitive(value);
  const childPath = (key: string | number) =>
    typeof key === "number" ? `${path}[${key}]` : path ? `${path}.${key}` : String(key);

  if (!isObj) {
    const { text, cls } = formatValue(value);
    return (
      <div className="flex gap-1.5 py-0.5 leading-relaxed">
        <button
          type="button"
          title="Copy JSON path"
          onClick={() => onCopyPath(path)}
          className="shrink-0 text-accent/90 hover:text-accent hover:underline"
        >
          {name}
        </button>
        <span className="text-muted/60">:</span>
        <span className={clsx("break-all", cls)}>{text}</span>
      </div>
    );
  }

  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);

  return (
    <div>
      <div className="flex items-center gap-1 py-0.5 leading-relaxed">
        <button type="button" onClick={() => setOpen(!open)} className="shrink-0 text-muted hover:text-txt">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <button
          type="button"
          title="Copy JSON path"
          onClick={() => onCopyPath(path)}
          className="shrink-0 text-accent/90 hover:text-accent hover:underline"
        >
          {name}
        </button>
        <span className="text-muted/60">:</span>
        {!open && <span className="text-[11px] italic text-muted/70">{nodeSummary(value)}</span>}
      </div>
      {open && (
        <div className="ml-4 border-l border-line/60 pl-2">
          {entries.map(([key, v]) => (
            <Node
              key={key}
              name={key}
              value={v}
              path={childPath(typeof v === "object" && Array.isArray(value) ? Number(key) : key)}
              depth={depth + 1}
              onCopyPath={onCopyPath}
              defaultOpen={depth + 1 < 2}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function JsonTree({ data }: { data: unknown }) {
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  async function onCopyPath(p: string) {
    await navigator.clipboard.writeText(p);
    setCopiedPath(p);
    setTimeout(() => setCopiedPath(null), 1200);
  }

  if (typeof data !== "object" || data === null) {
    const { text, cls } = formatValue(data);
    return <span className={cls}>{text}</span>;
  }

  return (
    <div className="relative">
      {copiedPath != null && (
        <span className="absolute right-2 top-1 z-10 flex items-center gap-1 rounded border border-accent/40 bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-accent">
          <Copy size={10} /> {copiedPath}
        </span>
      )}
      <div className="p-2 font-mono text-[12px]">
        <Node name="body" value={data} path="" depth={0} onCopyPath={onCopyPath} defaultOpen />
      </div>
    </div>
  );
}
