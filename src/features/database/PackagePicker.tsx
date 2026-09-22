import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronDown, Loader2, Package as PackageIcon, Search } from "lucide-react";
import type { AppProcess } from "../../store/console-types";
import { shortPackage } from "./dbdisplay";

const MAX_VISIBLE = 100;

export function PackagePicker({
  pkg,
  apps,
  loading,
  disabled,
  onSelect,
}: {
  pkg: string | null;
  apps: AppProcess[];
  loading: boolean;
  disabled: boolean;
  onSelect: (pkg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return apps;
    return apps.filter((a) => a.package.toLowerCase().includes(q));
  }, [apps, query]);
  const visible = matches.slice(0, MAX_VISIBLE);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function pick(app: AppProcess) {
    setOpen(false);
    onSelect(app.package);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        title={pkg ?? "Pick an installed app"}
        className="flex h-7 items-center gap-2 rounded-md border border-line bg-bg px-2 text-[12px] text-txt hover:border-muted/50 disabled:opacity-40"
      >
        <PackageIcon size={13} className="shrink-0 text-muted" />
        <span className="max-w-52 truncate font-mono">
          {pkg ? shortPackage(pkg) : "select package"}
        </span>
        {loading ? (
          <Loader2 size={13} className="animate-spin text-accent" />
        ) : (
          <ChevronDown size={13} className="text-muted" />
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-9 z-20 w-96 rounded-md border border-line bg-surface-2 p-1.5 shadow-xl">
          <div className="relative">
            <Search
              size={12}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted/70"
            />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && visible.length > 0) pick(visible[0]);
                if (e.key === "Escape") setOpen(false);
              }}
              placeholder="filter packages"
              className="h-7 w-full rounded-md border border-line bg-bg pl-6 pr-2 font-mono text-[11px] text-txt placeholder:text-muted/50 focus:border-accent focus:outline-none"
            />
          </div>
          {loading && apps.length === 0 && (
            <p className="flex items-center gap-2 px-2 py-2 text-[11px] text-muted">
              <Loader2 size={12} className="animate-spin" /> Loading packages…
            </p>
          )}
          {!loading && apps.length === 0 && (
            <p className="px-2 py-2 text-[11px] text-muted">
              No third-party packages found on this device.
            </p>
          )}
          {apps.length > 0 && matches.length === 0 && (
            <p className="px-2 py-2 text-[11px] text-muted">No packages match “{query.trim()}”.</p>
          )}
          <div className="mt-1 max-h-72 overflow-y-auto">
            {visible.map((a) => (
              <button
                key={a.package}
                type="button"
                onClick={() => pick(a)}
                title={a.package}
                className={clsx(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left font-mono text-[11px] hover:bg-surface",
                  pkg === a.package && "bg-surface",
                )}
              >
                <span
                  className={clsx(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    a.pid != null ? "bg-ok" : "bg-muted/40",
                  )}
                  title={a.pid != null ? "running" : "not running"}
                />
                <span className="shrink-0 font-medium text-txt/90">
                  {shortPackage(a.package)}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted/70">{a.package}</span>
                {pkg === a.package && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                )}
              </button>
            ))}
          </div>
          {matches.length > visible.length && (
            <p className="px-2.5 py-1.5 text-[10px] text-muted/70">
              Showing first {MAX_VISIBLE} of {matches.length} matches — keep typing to narrow down.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
