import { useMemo, useState } from "react";
import clsx from "clsx";
import { Check, ChevronDown, ChevronRight, ClipboardCopy, ClipboardList, Terminal, TextQuote, Type } from "lucide-react";
import type { Header, HttpExchange } from "../../store/types";
import { invoke } from "../../lib/tauri";
import { formatMs } from "../../lib/format";
import { loadSlowMs } from "../../lib/prefs";
import { Badge, IconButton } from "../../components/ui/primitives";
import { Button, type ButtonIcon } from "../../components/ui/Button";
import { Menu } from "../../components/ui/Menu";
import { BodyView } from "./BodyView";

type Tab = "headers" | "cookies" | "body" | "timing";

const TABS: { id: Tab; label: string }[] = [
  { id: "headers", label: "Headers" },
  { id: "cookies", label: "Cookies" },
  { id: "body", label: "Body" },
  { id: "timing", label: "Timing" },
];

function CopyButton({ label, icon: Icon, onCopy }: { label: string; icon: ButtonIcon; onCopy: () => Promise<string> | string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      title={label}
      icon={copied ? Check : Icon}
      onClick={async () => {
        const text = await onCopy();
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1300);
      }}
      className={clsx(copied && "text-ok! hover:text-ok!")}
    >
      {label}
    </Button>
  );
}

function HeaderRow({ header }: { header: Header }) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(text: string, what: string) {
    await navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1000);
  }

  return (
    <div className="group grid grid-cols-[170px_1fr_28px] items-start gap-2 rounded px-1.5 py-1 font-mono text-[length:var(--mono-size,12px)] hover:bg-surface-2/60">
      <button
        type="button"
        title="Copy name"
        onClick={() => copy(header.name, "name")}
        className={clsx(
          "truncate text-left text-muted hover:text-accent",
          copied === "name" && "text-ok",
        )}
      >
        {header.name}
      </button>
      <button
        type="button"
        title="Copy value"
        onClick={() => copy(header.value, "value")}
        className={clsx(
          "break-all text-left text-txt/90 hover:text-accent",
          copied === "value" && "text-ok",
        )}
      >
        {header.value}
      </button>
      <Menu
        items={[
          { key: "copy-name", label: "Copy name", icon: Type, onSelect: () => void copy(header.name, "name") },
          { key: "copy-value", label: "Copy value", icon: TextQuote, onSelect: () => void copy(header.value, "value") },
          { key: "copy-full", label: "Copy name: value", icon: ClipboardList, onSelect: () => void copy(`${header.name}: ${header.value}`, "full") },
        ]}
        onClose={() => {}}
        trigger={(t) => (
          <Button
            ref={t.ref}
            variant="ghost"
            size="icon"
            title="Copy options"
            onClick={t.onClick}
            aria-haspopup={t["aria-haspopup"]}
            aria-expanded={t["aria-expanded"]}
            className={clsx(
              "-mt-1 opacity-60 hover:opacity-100 focus-visible:opacity-100",
              copied === "full" && "text-ok! hover:text-ok!",
            )}
          >
            {copied === "full" ? <Check size={11} /> : <ClipboardList size={11} />}
          </Button>
        )}
      />
    </div>
  );
}

function HeaderSection({ title, rows, defaultOpen = false }: { title: string; rows: Header[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-line/50 last:border-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="press focus-ring flex w-full items-center gap-1.5 px-2 py-2 text-left hover:bg-surface-2/40"
      >
        {open ? <ChevronDown size={12} className="text-muted" /> : <ChevronRight size={12} className="text-muted" />}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</span>
        <span className="ml-auto rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{rows.length}</span>
      </button>
      {open && (
        <div className="pb-1">
          {rows.length === 0 ? (
            <p className="px-3 py-1 text-[12px] text-muted/60">none</p>
          ) : (
            rows.map((h, i) => <HeaderRow key={`${h.name}-${i}`} header={h} />)
          )}
        </div>
      )}
    </div>
  );
}

export function DetailPane({ ex, onClose, onCollapse }: { ex: HttpExchange; onClose: () => void; onCollapse: () => void }) {
  const [tab, setTab] = useState<Tab>("headers");

  const cookies = useMemo(() => {
    const rows: Header[] = [];
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

  async function curlFor() {
    return invoke<string>("format_curl", { exchange: ex });
  }

  const slowMs = loadSlowMs();
  const status = ex.response?.status ?? null;
  const t = ex.timing;
  const maxTotal = Math.max(t.ttfb_ms ?? 0, t.download_ms ?? 0, t.total_ms ?? 1);

  return (
    <div className="anim-slide-in-right flex w-[480px] max-w-[55vw] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-start gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] font-bold text-accent">{ex.request.method}</span>
            {status != null && (
              <span
                className={clsx(
                  "font-mono text-[12px] font-bold",
                  status < 300 ? "text-ok" : status < 400 ? "text-warn" : "text-danger",
                )}
              >
                {status}
              </span>
            )}
            {ex.error && <Badge tone="danger">error</Badge>}
            <span className="text-[10px] text-muted">{ex.protocol}</span>
          </div>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(ex.request.url)}
            title="Copy URL"
            className="mt-1 block w-full truncate text-left font-mono text-[12px] text-txt/85 hover:text-accent"
          >
            {ex.request.url}
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
          <CopyButton label="cURL" icon={Terminal} onCopy={curlFor} />
          <CopyButton
            label="Body"
            icon={ClipboardCopy}
            onCopy={() => ex.response?.body?.text ?? ex.request.body?.text ?? ""}
          />
          <IconButton title="Collapse detail" onClick={onCollapse}>
            <ChevronRight size={14} />
          </IconButton>
          <IconButton title="Close" onClick={onClose}>
            ✕
          </IconButton>
        </div>
      </div>

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
            <HeaderSection title="Request headers" rows={ex.request.headers} />
            <HeaderSection title="Response headers" rows={ex.response?.headers ?? []} />
          </>
        )}
        {tab === "cookies" && <HeaderSection title="Cookies" rows={cookies} defaultOpen />}
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
            ].map((row) => {
              const isSlow = row.ms != null && row.ms > slowMs;
              return (
                <div key={row.label} className="flex items-center gap-3">
                  <span className="w-20 text-[12px] text-muted">{row.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={clsx("h-full rounded-full", isSlow ? "bg-danger" : "bg-accent")}
                      style={{ width: `${Math.round(((row.ms ?? 0) / maxTotal) * 100)}%` }}
                    />
                  </div>
                  <span className={clsx("w-16 text-right font-mono text-[12px] tabular-nums", isSlow && "text-danger")}>
                    {formatMs(row.ms)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
