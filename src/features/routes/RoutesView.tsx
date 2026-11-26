import clsx from "clsx";
import { ArrowRight, Copy, FileCode2, RotateCcw, Route } from "lucide-react";
import { invoke } from "../../lib/tauri";
import { qError } from "../../lib/query";
import { useTraffic } from "../../store/traffic";
import { useReloadRoutes, useRoutesStatus } from "../../queries/routes";
import { Button } from "../../components/ui/Button";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { Badge } from "../../components/ui/primitives";
import { Toggle } from "../../components/ui/Toggle";
import { toast } from "../../components/ui/toast";
import type { RouteFileStatus, RouteHealth, RouteStatus } from "../../store/types";
import { CONFIG_SNIPPET, hitKey, routePill, totalHits, type RoutePill } from "./routes";
import { useRoutes } from "./store";

const PILLS: Record<RoutePill, { label: string; tone: "ok" | "danger" | "muted" }> = {
  healthy: { label: "Healthy", tone: "ok" },
  unreachable: { label: "Unreachable", tone: "danger" },
  checking: { label: "Checking", tone: "muted" },
  off: { label: "Off", tone: "muted" },
};

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <span className="block truncate text-[11px] text-muted">{label}</span>
      <span
        className={clsx(
          "block truncate font-mono text-[20px] font-semibold leading-7 tabular-nums",
          danger ? "text-danger" : "text-txt",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function RouteRow({
  route,
  enabled,
  health,
  hits,
}: {
  route: RouteStatus;
  enabled: boolean;
  health: RouteHealth | undefined;
  hits: number;
}) {
  const setEnabled = useRoutes((s) => s.setEnabled);
  const pill = PILLS[routePill(enabled, health)];
  return (
    <li className="grid grid-cols-[32px_minmax(80px,140px)_minmax(0,1fr)_14px_minmax(0,1fr)_96px_64px] items-center gap-3 px-3 py-2 text-[12px]">
      <Toggle checked={enabled} onChange={(on) => setEnabled(route.key, on)} label={`Enable ${route.id}`} />
      <span className="truncate font-semibold text-txt" title={route.id}>
        {route.id}
      </span>
      <span className="min-w-0 truncate font-mono text-txt" title={route.path_prefix}>
        {route.host && <span className="text-muted">{route.host}</span>}
        <span>{route.path_prefix}</span>
      </span>
      <ArrowRight size={14} aria-hidden="true" className="text-muted" />
      <span className="min-w-0 truncate font-mono text-muted" title={route.target}>
        {route.target}
      </span>
      <Badge tone={pill.tone} className="justify-self-start">
        {pill.label}
      </Badge>
      <span className="text-right font-mono tabular-nums text-muted">{plural(hits, "hit")}</span>
    </li>
  );
}

function RouteGroup({
  file,
  enabled,
  health,
  reloading,
  onReload,
}: {
  file: RouteFileStatus;
  enabled: string[];
  health: Record<string, RouteHealth>;
  reloading: boolean;
  onReload: () => void;
}) {
  const hits = useTraffic((s) => s.routedHits);
  return (
    <section aria-label={file.name} className="overflow-hidden rounded-[10px] bg-surface-2/60">
      <header className="flex min-w-0 items-center gap-3 px-3 py-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[12px] font-semibold text-txt">{file.name}</h3>
          <p className="truncate font-mono text-[11px] text-muted" title={file.path}>
            {file.path}
          </p>
        </div>
        <span className="shrink-0 text-[11px] text-muted">{plural(file.routes.length, "route")}</span>
        <Button size="sm" icon={RotateCcw} disabled={reloading} onClick={onReload}>
          Reload
        </Button>
      </header>
      {file.error && (
        <div className="px-3 pb-2">
          <ErrorBox message={file.error} />
        </div>
      )}
      {file.routes.length > 0 && (
        <ul className="divide-y divide-line border-t border-line">
          {file.routes.map((route) => (
            <RouteRow
              key={route.key}
              route={route}
              enabled={enabled.includes(route.key)}
              health={health[route.key]}
              hits={hits.get(hitKey(route.id, route.target)) ?? 0}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function RoutesEmpty() {
  return (
    <div className="panel flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <Route size={28} aria-hidden="true" className="text-muted/60" />
      <p className="text-sm font-medium text-txt">Route requests to local services</p>
      <p className="max-w-sm text-[12px] text-muted">
        Add the absolute path of a route file to files in the [routes] section of config.toml.
        Each enabled route sends a path prefix to a service running on this machine.
      </p>
      <pre className="rounded-[8px] bg-surface-2 px-3 py-2 text-left font-mono text-[11px] text-muted">
        {CONFIG_SNIPPET}
      </pre>
      <div className="flex items-center gap-2">
        <Button
          variant="subtle"
          size="sm"
          icon={Copy}
          onClick={() => {
            navigator.clipboard
              .writeText(CONFIG_SNIPPET)
              .then(() => toast("Config snippet copied to clipboard"))
              .catch(() => toast("Clipboard unavailable", "danger"));
          }}
        >
          Copy config snippet
        </Button>
        <Button size="sm" icon={FileCode2} onClick={() => invoke("reveal_config").catch(() => {})}>
          Open config.toml
        </Button>
      </div>
    </div>
  );
}

export function RoutesView() {
  const { query, files, enabled, health, summary } = useRoutesStatus();
  const reload = useReloadRoutes();
  const rerouted = useTraffic((s) => totalHits(s.routedHits));
  const enableAll = useRoutes((s) => s.enableAll);
  const disableAll = useRoutes((s) => s.disableAll);
  const error = qError(query.error);

  if (error) {
    return (
      <div className="panel flex h-full flex-col items-center justify-center gap-3 p-8">
        <ErrorBox message={error} />
        <Button size="sm" icon={RotateCcw} onClick={() => void query.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (query.isPending) {
    return <div className="panel h-full p-6 text-[12px] text-muted">Loading routes...</div>;
  }
  if (files.length === 0) return <RoutesEmpty />;

  return (
    <section aria-label="Routes" className="panel h-full overflow-y-auto">
      <div className="flex max-w-[1180px] flex-col gap-4 px-6 pb-6 pt-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-semibold text-txt">Routes</h2>
          <span className="flex-1" />
          <Button
            variant="subtle"
            size="sm"
            disabled={summary.total === 0}
            onClick={() => enableAll(files.flatMap((f) => f.routes.map((r) => r.key)))}
          >
            Enable all
          </Button>
          <Button size="sm" onClick={disableAll}>
            Disable all
          </Button>
        </div>
        <div className="grid grid-cols-3 divide-x divide-line rounded-[10px] bg-surface-2">
          <Stat label="Local routes" value={`${summary.enabled}/${summary.total}`} />
          <Stat label="Rerouted requests" value={String(rerouted)} />
          <Stat label="Unreachable" value={String(summary.unreachable)} danger={summary.unreachable > 0} />
        </div>
        {files.map((file) => (
          <RouteGroup
            key={file.path}
            file={file}
            enabled={enabled}
            health={health}
            reloading={reload.isPending}
            onReload={() => reload.mutate()}
          />
        ))}
      </div>
    </section>
  );
}
