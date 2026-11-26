import clsx from "clsx";
import { ArrowRight, CircleCheck, FileCode2, Plug, RotateCcw, Route, Trash2 } from "lucide-react";
import { qError } from "../../lib/query";
import { useTraffic } from "../../store/traffic";
import { useReloadRoutes, useRoutesStatus } from "../../queries/routes";
import { Button } from "../../components/ui/Button";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { Badge } from "../../components/ui/primitives";
import { Toggle } from "../../components/ui/Toggle";
import type { RouteFileStatus, RouteHealth, RouteStatus } from "../../store/types";
import { hitKey, routePill, totalHits, type RoutePill } from "./routes";
import { useRoutes } from "./store";
import { useConnect } from "./connectStore";

const PILLS: Record<RoutePill, { label: string; tone: "ok" | "danger" | "muted"; dot?: string }> = {
  healthy: { label: "Healthy", tone: "ok" },
  unreachable: { label: "Unreachable", tone: "danger" },
  checking: { label: "Checking", tone: "muted" },
  ready: { label: "Ready", tone: "muted", dot: "bg-ok" },
  stopped: { label: "Not running", tone: "muted", dot: "bg-muted/50" },
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
  files,
}: {
  files: RouteFileStatus[];
  route: RouteStatus;
  enabled: boolean;
  health: RouteHealth | undefined;
  hits: number;
}) {
  const setEnabled = useRoutes((s) => s.setEnabled);
  const pill = PILLS[routePill(enabled, health)];
  return (
    <li className="grid grid-cols-[32px_minmax(80px,140px)_minmax(0,1fr)_14px_minmax(0,1fr)_96px_64px] items-center gap-3 px-3 py-2 text-[12px]">
      <Toggle checked={enabled} onChange={(on) => setEnabled(route.key, on, files)} label={`Enable ${route.id}`} />
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
      <Badge tone={pill.tone} className="justify-self-start whitespace-nowrap">
        {pill.dot && <span aria-hidden="true" className={clsx("mr-1 h-1.5 w-1.5 rounded-full", pill.dot)} />}
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
  files,
}: {
  files: RouteFileStatus[];
  file: RouteFileStatus;
  enabled: string[];
  health: Record<string, RouteHealth>;
  reloading: boolean;
  onReload: () => void;
}) {
  const hits = useTraffic((s) => s.routedHits);
  const removeFile = useConnect((s) => s.removeFile);
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
        <Button
          size="sm"
          icon={Trash2}
          aria-label={`Remove ${file.name}`}
          onClick={() => removeFile(file.path)}
        >
          Remove
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
              files={files}
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
  const open = useConnect((s) => s.open);
  const chooseFile = useConnect((s) => s.chooseFile);
  return (
    <div className="panel flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-muted">
        <Route size={22} aria-hidden="true" />
      </span>
      <p className="text-sm font-medium text-txt">Send app traffic to your local services</p>
      <p className="max-w-sm text-[12px] text-muted">
        Pick the endpoints you're working on and Beholder sends them to your machine. Everything else
        keeps going to the real server.
      </p>
      <div className="mt-1 flex items-center gap-2">
        <Button variant="primary" icon={Plug} onClick={open}>
          Connect services
        </Button>
        <Button icon={FileCode2} onClick={chooseFile}>
          Choose file…
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        Beholder looks for a local stack on localhost. Nothing leaves your machine.
      </p>
    </div>
  );
}

function ConnectedBanner() {
  const banner = useConnect((s) => s.banner);
  const dismiss = useConnect((s) => s.dismiss);
  if (banner === null) return null;
  return (
    <div role="status" className="flex items-center gap-3 rounded-[10px] bg-ok/14 px-3 py-2">
      <CircleCheck size={15} aria-hidden="true" className="shrink-0 text-ok" />
      <p className="min-w-0 flex-1 text-[12px] text-txt">{banner}</p>
      <Button size="sm" onClick={dismiss}>
        Got it
      </Button>
    </div>
  );
}

function NoReroutedYet() {
  return (
    <div className="flex flex-col items-center gap-1 rounded-[10px] border border-dashed border-line px-4 py-5 text-center">
      <p className="text-[12px] font-medium text-txt">No rerouted requests yet</p>
      <p className="text-[11px] text-muted">Turn on a route above, start a capture and use your app.</p>
    </div>
  );
}

export function RoutesView() {
  const { query, files, enabled, health, summary } = useRoutesStatus();
  const reload = useReloadRoutes();
  const rerouted = useTraffic((s) => totalHits(s.routedHits));
  const enableAll = useRoutes((s) => s.enableAll);
  const disableAll = useRoutes((s) => s.disableAll);
  const connectServices = useConnect((s) => s.open);
  const chooseFile = useConnect((s) => s.chooseFile);
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
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[13px] font-semibold text-txt">Routes</h2>
          <span className="flex-1" />
          <Button variant="primary" size="sm" icon={Plug} onClick={connectServices}>
            Connect services
          </Button>
          <Button size="sm" icon={FileCode2} onClick={chooseFile}>
            Choose file…
          </Button>
          <span aria-hidden="true" className="mx-1 h-4 w-px bg-line" />
          <Button
            variant="subtle"
            size="sm"
            disabled={summary.total === 0}
            onClick={() => enableAll(files)}
          >
            Enable all
          </Button>
          <Button size="sm" onClick={disableAll}>
            Disable all
          </Button>
        </div>
        <ConnectedBanner />
        <div className="grid grid-cols-3 divide-x divide-line rounded-[10px] bg-surface-2">
          <Stat label="Local routes" value={`${summary.enabled}/${summary.total}`} />
          <Stat label="Rerouted requests" value={String(rerouted)} />
          <Stat label="Unreachable" value={String(summary.unreachable)} danger={summary.unreachable > 0} />
        </div>
        {files.map((file) => (
          <RouteGroup
            key={file.path}
            files={files}
            file={file}
            enabled={enabled}
            health={health}
            reloading={reload.isPending}
            onReload={() => reload.mutate()}
          />
        ))}
        {rerouted === 0 && <NoReroutedYet />}
      </div>
    </section>
  );
}
