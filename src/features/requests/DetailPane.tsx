import { useMemo, useState } from "react";
import clsx from "clsx";
import { Terminal } from "lucide-react";
import type { HttpExchange } from "../../store/types";
import { invoke } from "../../lib/tauri";
import { formatMs, statusClass } from "../../lib/format";
import { Badge, IconButton } from "../../components/ui/primitives";
import { BodyView } from "./BodyView";

type Tab = "headers" | "cookies" | "body" | "timing";

const TABS: { id: Tab; label: string }[] = [
  { id: "headers", label: "Headers" },
  { id: "cookies", label: "Cookies" },
  { id: "body", label: "Body" },
  { id: "timing", label: "Timing" },
];

function HeaderTable({ rows }: { rows: { name: string; value: string }[] }) {
  if (rows.length === 0) return <p className="p-3 text-[12px] text-muted">None</p>;
  return (
    <div className="p-2 font-mono text-[12px]">
      {rows.map((h, i) => (
        <div key={i} className="grid grid-cols-[180px_1fr] gap-2 rounded px-1 py-0.5 hover:bg-surface-2">
          <span className="truncate text-muted">{h.name}</span>
          <span className="break-all text-txt/90">{h.value}</span>
        </div>
      ))}
    </div>
  );
}

export function DetailPane({ ex, onClose }: { ex: HttpExchange; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("headers");
  const [copied, setCopied] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);

  const cookies = useMemo(() => {
    const rows: { name: string; value: string }[] = [];
    for (const h of [...ex.request.headers, ...(ex.response?.headers ?? [])]) {
      const lower = h.name.toLowerCase();
      if (lower === "cookie" || lower === "set-cookie") {
        for (const part of h.value.split(";")) {
          const idx = part.indexOf("=");
          if (idx > 0) {
            rows.push({ name: part.slice(0, idx).trim(), value: part.slice(idx + 1).trim() });
          }
        }
      }
    }
    return rows;
  }, [ex]);

  async function copyUrl() {
    await navigator.clipboard.writeText(ex.request.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  async function copyCurl() {
    const cmd = await invoke<string>("format_curl", { exchange: ex });
    await navigator.clipboard.writeText(cmd);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 1500);
  }

  const status = ex.response?.status ?? null;
  const t = ex.timing;
  const maxTotal = Math.max(t.ttfb_ms ?? 0, t.download_ms ?? 0, t.total_ms ?? 1);

  return (
    <div className="flex w-[460px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-start gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] font-semibold text-accent">{ex.request.method}</span>
            {status != null && <Badge tone={statusClass(status)}>{status}</Badge>}
            {ex.error && <Badge tone="danger">error</Badge>}
            <span className="text-[11px] text-muted">{ex.protocol}</span>
          </div>
          <button
            type="button"
            onClick={copyUrl}
            title="Copy URL"
            className="mt-0.5 block w-full truncate text-left font-mono text-[12px] text-txt/90 hover:text-accent"
          >
            {ex.request.url} {copied && <span className="text-accent">copied</span>}
          </button>
        </div>
        <IconButton title="Copy as cURL" onClick={copyCurl}>
          <Terminal size={14} />
        </IconButton>
        <IconButton title="Close" onClick={onClose}>
          ✕
        </IconButton>
      </div>
      {copiedCurl && (
        <div className="border-b border-line bg-surface-2 px-3 py-1 text-[11px] text-accent">
          cURL copied to clipboard
        </div>
      )}
      <div className="flex gap-1 border-b border-line px-2 py-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={clsx(
              "rounded px-2 py-1 text-[11px] font-medium transition-colors",
              tab === t.id ? "bg-surface-2 text-accent" : "text-muted hover:text-txt",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto">
        {tab === "headers" && (
          <>
            <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Request</p>
            <HeaderTable rows={ex.request.headers} />
            <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Response</p>
            <HeaderTable rows={ex.response?.headers ?? []} />
          </>
        )}
        {tab === "cookies" && <HeaderTable rows={cookies} />}
        {tab === "body" && (
          <>
            <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Request body</p>
            <BodyView body={ex.request.body} />
            <p className="border-t border-line px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
              Response body
            </p>
            <BodyView body={ex.response?.body} />
          </>
        )}
        {tab === "timing" && (
          <div className="flex flex-col gap-3 p-4">
            {[
              { label: "TTFB", ms: t.ttfb_ms },
              { label: "Download", ms: t.download_ms },
              { label: "Total", ms: t.total_ms },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-3">
                <span className="w-20 text-[12px] text-muted">{row.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.round(((row.ms ?? 0) / maxTotal) * 100)}%` }}
                  />
                </div>
                <span className="w-16 text-right font-mono text-[12px]">{formatMs(row.ms)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
