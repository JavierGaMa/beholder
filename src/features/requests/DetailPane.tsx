import { useMemo, useState } from "react";
import clsx from "clsx";
import { Check, ChevronDown, ChevronRight, ClipboardCopy, ClipboardList, Terminal, TextQuote, Type, X } from "lucide-react";
import type { Header, HttpExchange } from "../../store/types";
import { invoke } from "../../lib/tauri";
import { formatBytes, formatMs, formatTime } from "../../lib/format";
import { loadSlowMs } from "../../lib/prefs";
import { EmptyState, IconButton } from "../../components/ui/primitives";
import { Button, type ButtonIcon } from "../../components/ui/Button";
import { Menu } from "../../components/ui/Menu";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { BodyView } from "./BodyView";
import { StatusPill } from "./RequestRow";
import { timingPhases } from "./timing";

type Tab = "headers" | "cookies" | "body" | "timing";

const TABS: { id: Tab; label: string }[] = [
  { id: "headers", label: "Headers" },
  { id: "cookies", label: "Cookies" },
  { id: "body", label: "Body" },
  { id: "timing", label: "Timing" },
];

function CopyButton({
  label,
  title,
  icon: Icon,
  onCopy,
}: {
  label?: string;
  title: string;
  icon: ButtonIcon;
  onCopy: () => Promise<string> | string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size={label ? "sm" : "icon"}
      title={title}
      aria-label={title}
      icon={copied ? Check : Icon}
      onClick={async () => {
        const text = await onCopy();
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1300);
      }}
      className={clsx(label && "ring-1 ring-inset ring-line", copied && "text-ok! hover:text-ok!")}
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
    <div className="group grid grid-cols-[170px_1fr_28px] items-start gap-2 rounded px-1.5 py-1 font-mono text-[length:var(--mono-size,12px)] hover:bg-surface-2">
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
    <div className="pb-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="press focus-ring flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left hover:bg-surface-2"
      >
        {open ? <ChevronDown size={12} className="text-muted" /> : <ChevronRight size={12} className="text-muted" />}
        <span className="text-[12px] font-semibold text-txt">{title}</span>
        <span className="ml-auto rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">{rows.length}</span>
      </button>
      {open && (
        <div className="mt-1 rounded-[10px] bg-surface-2/60 p-1">
          {rows.length === 0 ? (
            <p className="px-2 py-1 text-[12px] text-muted/60">none</p>
          ) : (
            rows.map((h, i) => <HeaderRow key={`${h.name}-${i}`} header={h} />)
          )}
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-0.5 truncate font-mono text-[13px] text-txt">{value}</p>
    </div>
  );
}

const PHASE_OPACITY = ["opacity-100", "opacity-60", "opacity-35"];

export function DetailEmpty() {
  return <EmptyState title="No request selected" hint="Select a request to inspect it" />;
}

export function DetailPane({ ex, onClose }: { ex: HttpExchange; onClose: () => void }) {
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
  const t = ex.timing;
  const size = ex.response?.body?.size ?? ex.request.body?.size ?? null;
  const phases = timingPhases(t);
  const totalSlow = t.total_ms != null && t.total_ms > slowMs;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-[18px] pb-3.5 pt-1">
        <div className="flex min-w-0 items-center gap-2 text-[12px]">
          <StatusPill ex={ex} failLabel="Connection failed" className="py-0.5 font-mono" />
          <span className="shrink-0 font-mono text-muted">{ex.request.method}</span>
          <span className="min-w-0 truncate font-mono text-[11px] text-muted/70">{ex.protocol}</span>
          <span className="flex-1" />
          <CopyButton label="Copy as cURL" title="Copy as cURL" icon={Terminal} onCopy={curlFor} />
          <CopyButton
            title="Copy body"
            icon={ClipboardCopy}
            onCopy={() => ex.response?.body?.text ?? ex.request.body?.text ?? ""}
          />
          <IconButton title="Close" onClick={onClose}>
            <X size={14} />
          </IconButton>
        </div>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(ex.request.url)}
          title="Copy URL"
          className="mt-2.5 block w-full text-left font-mono text-[15px] font-semibold leading-[1.45] tracking-[-0.01em] break-all text-txt hover:text-accent"
        >
          <span className="font-normal text-muted">{ex.request.host}</span>
          {ex.request.path}
        </button>
        {ex.request.routed && (
          <p className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] text-muted">
            <span>Routed to</span>
            <span className="font-semibold text-accent">{ex.request.routed.route_id}</span>
            <span className="break-all font-mono text-txt">{ex.request.routed.target}</span>
          </p>
        )}
        {ex.error && <p className="mt-1.5 font-mono text-[12px] text-danger">{ex.error}</p>}
        <div className="mt-4 grid grid-cols-3 divide-x divide-line rounded-[10px] bg-surface-2">
          <Fact label="Duration" value={t.total_ms == null ? "none" : formatMs(t.total_ms)} />
          <Fact label="Size" value={size == null ? "none" : formatBytes(size)} />
          <Fact label="Started at" value={formatTime(ex.request.started_at)} />
        </div>
      </div>

      <div className="shrink-0 px-[18px] pb-2">
        <SegmentedControl options={TABS.map((x) => ({ value: x.id, label: x.label }))} value={tab} onChange={setTab} ariaLabel="Detail tabs" />
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-[18px] pb-4 pt-2">
        {tab === "headers" && (
          <>
            <HeaderSection title="Request headers" rows={ex.request.headers} />
            <HeaderSection title="Response headers" rows={ex.response?.headers ?? []} />
          </>
        )}
        {tab === "cookies" && <HeaderSection title="Cookies" rows={cookies} defaultOpen />}
        {tab === "body" && (
          <div className="flex flex-col gap-4">
            <section>
              <h3 className="mb-2 text-[12px] font-semibold text-txt">Request body</h3>
              <div className="overflow-hidden rounded-[10px] bg-surface-2">
                <BodyView body={ex.request.body} />
              </div>
            </section>
            <section>
              <h3 className="mb-2 text-[12px] font-semibold text-txt">Response body</h3>
              <div className="overflow-hidden rounded-[10px] bg-surface-2">
                <BodyView body={ex.response?.body} />
              </div>
            </section>
          </div>
        )}
        {tab === "timing" && (
          <div className="flex flex-col gap-3">
            <h3 className="text-[12px] font-semibold text-txt">Timing</h3>
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-surface-2">
              {phases.map((p, i) => (
                <span
                  key={p.label}
                  className={clsx("h-full rounded-full bg-accent", PHASE_OPACITY[i])}
                  style={{ flexGrow: p.ms, flexBasis: 0 }}
                />
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              {phases.map((p, i) => (
                <div key={p.label} className="flex items-center gap-2.5 text-[12px]">
                  <span className={clsx("h-2 w-2 rounded-[2px] bg-accent", PHASE_OPACITY[i])} />
                  <span className="text-txt">{p.label}</span>
                  <span className="ml-auto font-mono text-muted tabular-nums">{formatMs(p.ms)}</span>
                </div>
              ))}
              <div className="mt-1 flex items-center gap-2.5 border-t border-line pt-2 text-[12px]">
                <span className="h-2 w-2" />
                <span className="text-txt">Total</span>
                <span className={clsx("ml-auto font-mono tabular-nums", totalSlow ? "font-semibold text-warn" : "text-muted")}>
                  {formatMs(t.total_ms)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
