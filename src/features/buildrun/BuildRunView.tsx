import { useState } from "react";
import clsx from "clsx";
import { Activity, CircleAlert, Play, RotateCcw, Search, Square, TriangleAlert } from "lucide-react";
import { onlineDevices } from "../apks/deviceOptions";
import { useAdbDevicesQuery } from "../../queries/devices";
import {
  useBuildAndRunMutation,
  useForceStopAppMutation,
  useMetroStartMutation,
  useMetroStopMutation,
  useRnVariantsMutation,
  type RnVariantsInfo,
} from "../../queries/buildrun";
import { useTraffic } from "../../store/traffic";
import { qError } from "../../lib/query";
import { toast } from "../../components/ui/toast";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { Badge, Panel } from "../../components/ui/primitives";
import {
  NO_FLAVOR,
  INSTALL_UNINSTALLS_NOTE,
  assembleTaskName,
  buildrunWarnings,
  metroPanelState,
  pickDefaultSerial,
  reloadTargets,
} from "./buildrunState";
import { useTauriLogStream } from "./useTauriLogStream";
import { logFootnote } from "./logStream";

export function BuildRunView() {
  const targetSerial = useTraffic((s) => s.targetSerial);
  const metroStatus = useTraffic((s) => s.metro);

  const variants = useRnVariantsMutation();
  const run = useBuildAndRunMutation();
  const metroStart = useMetroStartMutation();
  const metroStop = useMetroStopMutation();
  const reload = useForceStopAppMutation();
  const devicesQ = useAdbDevicesQuery();

  const [path, setPath] = useState("");
  const [flavor, setFlavor] = useState(NO_FLAVOR);
  const [buildType, setBuildType] = useState("debug");
  const [serialPicked, setSerialPicked] = useState<string | null>(null);
  const [runId, setRunId] = useState<number>(0);

  const buildLog = useTauriLogStream("build-log", runId);
  const metroLog = useTauriLogStream("metro-log", 0);

  const info = variants.data ?? null;
  const running = onlineDevices(devicesQ.data);
  const defaultSerial = pickDefaultSerial(
    targetSerial,
    running.map((d) => d.serial),
  );
  const serial = serialPicked ?? defaultSerial;

  const warnings = buildrunWarnings(info);
  const installTargets = reloadTargets(info);

  const chosenFlavor =
    info && info.flavors.includes(flavor) ? flavor : NO_FLAVOR;
  const chosenBuildType = info
    ? info.buildTypes.includes(buildType)
      ? buildType
      : (info.buildTypes[0] ?? "debug")
    : "debug";
  const projectRoot = info?.projectRoot ?? (path.trim() !== "" ? path.trim() : null);

  const metroPanel = metroPanelState(metroStatus, metroStart.isPending);
  const canRun = run.isPending === false && serial !== "" && path.trim() !== "";

  function detect() {
    if (path.trim() === "") return;
    variants.mutate(
      { path: path.trim() },
      {
        onSuccess: (data) => {
          toast(`${data.flavors.length} flavors detected`);
        },
      },
    );
  }

  function runVariant() {
    if (!canRun || !projectRoot) return;
    setRunId((n) => n + 1);
    run.mutate(
      {
        projectPath: projectRoot,
        flavor: chosenFlavor === NO_FLAVOR ? null : chosenFlavor,
        buildType: chosenBuildType,
        serial,
      },
      {
        onSuccess: () =>
          toast(`launched on ${serial}, change JS with Metro hot reload`),
      },
    );
  }

  function startMetro() {
    if (!projectRoot) return;
    metroStart.mutate(
      { projectPath: projectRoot },
      {
        onSuccess: (mi) => {
          if (mi.running) {
            toast(`metro already running on :${mi.port}`);
          } else if (mi.spawned) {
            toast("metro starting — wait until the badge turns green");
          }
        },
      },
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 overflow-y-auto p-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="shrink-0 text-sm font-semibold text-txt">Build &amp; Run</h1>
        {info && <Badge tone="muted">{assembleTaskNameLabel(chosenFlavor, chosenBuildType)}</Badge>}
      </div>

      <Panel className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold">React Native project</h2>
        <div className="flex items-end gap-2">
          <div className="min-w-72 flex-1">
            <Input
              mono
              label="Project root"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") detect();
              }}
              placeholder="/home/dev/rn-app"
              aria-label="React Native project root path"
            />
          </div>
          <Button
            variant="subtle"
            icon={Search}
            disabled={path.trim() === "" || variants.isPending}
            onClick={detect}
            className="shrink-0"
          >
            Detect
          </Button>
        </div>

        {variants.isPending && <p className="text-[11px] text-muted">reading gradle file...</p>}

        {variants.isError && (
          <ErrorBox message={qError(variants.error) ?? "could not detect the project"} compact />
        )}

        {info && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="muted">{info.flavors.length} flavors</Badge>
              <Badge tone="muted">{info.buildTypes.length} build types</Badge>
              <p
                className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted/70"
                title={info.gradleFile}
              >
                {info.gradleFile}
              </p>
            </div>
            {warnings.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {warnings.map((w) => (
                  <p
                    key={w.id}
                    className={clsx(
                      "flex items-start gap-2 rounded-md border p-2 text-[11px]",
                      w.kind === "danger"
                        ? "border-danger/40 bg-danger/10 text-danger"
                        : "border-warn/40 bg-warn/10 text-warn",
                    )}
                  >
                    {w.kind === "danger" ? (
                      <CircleAlert size={13} className="shrink-0" />
                    ) : (
                      <TriangleAlert size={13} className="shrink-0" />
                    )}
                    <span>{w.text}</span>
                  </p>
                ))}
              </div>
            )}
          </>
        )}

        {!info && !variants.isError && !variants.isPending && (
          <p className="text-[11px] text-muted/70">
            Enter a React Native project root and press Detect — Beholder reads
            productFlavors and build types from android/app/build.gradle(.kts).
          </p>
        )}
      </Panel>

      <Panel className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold">Variant</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-40 flex-1">
            <Select
              label="Flavor"
              value={chosenFlavor}
              onChange={(e) => setFlavor(e.target.value)}
              disabled={!info}
              aria-label="Product flavor"
            >
              {flavorOptions(info).map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-40 flex-1">
            <Select
              label="Build type"
              value={chosenBuildType}
              onChange={(e) => setBuildType(e.target.value)}
              disabled={!info}
              aria-label="Build type"
            >
              {(info?.buildTypes ?? ["debug"]).map((bt) => (
                <option key={bt} value={bt}>
                  {bt}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-40 flex-1">
            <Select
              label="Device"
              value={serial}
              onChange={(e) => setSerialPicked(e.target.value)}
              disabled={running.length === 0}
              aria-label="Target device"
            >
              {running.length === 0 ? (
                <option value="">no device online</option>
              ) : (
                running.map((d) => (
                  <option key={d.serial} value={d.serial}>
                    {d.serial}
                    {d.is_emulator ? " · emulator" : " · device"}
                  </option>
                ))
              )}
            </Select>
          </div>
          <Button
            variant="primary"
            icon={Play}
            disabled={!canRun || !projectRoot}
            onClick={runVariant}
            className="shrink-0"
            title={
              serial === ""
                ? "Start an emulator first"
                : undefined
            }
          >
            Run
          </Button>
        </div>
        <p className="text-[11px] text-muted/70">
          Run builds, installs and launches the variant on the selected device —{" "}
          {INSTALL_UNINSTALLS_NOTE}. Capture stays device-wide and keeps working.
        </p>

        {run.isError && <ErrorBox message={qError(run.error) ?? "build failed"} />}

        <h3 className="pt-1 text-[11px] font-medium uppercase tracking-wider text-muted/70">
          Install log
        </h3>
        <LogPane page={buildLog} />
      </Panel>

      <Panel className="flex flex-col gap-2 p-4">
        <h2 className="text-sm font-semibold">Hot loop — reload without a new build</h2>
        <p className="text-[11px] text-muted/70">
          Gradle builds are one-time per flavor. For daily JS changes keep Metro running and reload:
          force-stops the app for a variant&apos;s package on the selected device; reopening it picks
          the bundle from Metro.
        </p>
        <div className="flex flex-col divide-y divide-line/50">
          {installTargets.map((t) => (
            <div key={t.key} className="flex items-center justify-between gap-2 py-1.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-[12px] font-medium">{t.label}</span>
                <span
                  className="min-w-0 truncate font-mono text-[10px] text-muted"
                  title={t.pkg ?? "unknown package id"}
                >
                  {t.pkg ?? "unknown package id"}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon={RotateCcw}
                disabled={reload.isPending || !t.pkg || serial === ""}
                onClick={() => {
                  if (t.pkg) reload.mutate({ serial, package: t.pkg });
                }}
                className="shrink-0"
                title={t.pkg ? `force-stop ${t.pkg}` : "package id unknown"}
              >
                Reload
              </Button>
            </div>
          ))}
          {installTargets.length === 0 && (
            <p className="py-1.5 text-[11px] text-muted/70">run Detect to list installed variants</p>
          )}
        </div>
        {reload.isError && (
          <ErrorBox message={qError(reload.error) ?? "reload failed"} compact />
        )}
        {reload.isSuccess && <Badge tone="ok">app stopped — reopen it to reload</Badge>}
      </Panel>

      <Panel className="flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Activity size={14} className="text-muted" /> Metro dev server
          </h2>
          <div className="flex items-center gap-2">
            <span
              className={clsx(
                "h-2 w-2 rounded-full",
                metroPanel.tone === "ok" && "bg-ok",
                metroPanel.tone === "warn" && "animate-pulse bg-warn",
                metroPanel.tone === "muted" && "bg-muted/50",
                metroPanel.tone === "danger" && "bg-danger",
              )}
              title={metroPanel.label}
            />
            <span className={clsx("text-[11px]", metroPanel.tone === "ok" ? "text-ok" : "text-muted")}>
              {metroPanel.label}
            </span>
            <Button
              variant="ghost"
              size="sm"
              icon={Square}
              disabled={metroStop.isPending || !metroStatus?.detected}
              onClick={() => metroStop.mutate()}
              className="shrink-0"
              title={metroStatus?.detected ? "Stop the metro dev server" : "metro is not running"}
            >
              Stop
            </Button>
            <Button
              variant="subtle"
              size="sm"
              icon={Play}
              disabled={metroStart.isPending || !!metroStatus?.detected || !projectRoot}
              onClick={startMetro}
              className="shrink-0"
              title={
                projectRoot
                  ? "Start the metro dev server for this project"
                  : "detect the project first"
              }
            >
              Start
            </Button>
          </div>
        </div>
        <p className="text-[11px] text-muted/70">
          Run the dev build (debug) with Metro up and the app bundles from the local server.
        </p>
        {metroStart.isError && (
          <ErrorBox message={qError(metroStart.error) ?? "metro failed to start"} compact />
        )}
        <LogPane page={metroLog} />
      </Panel>
    </div>
  );
}

function flavorOptions(info: RnVariantsInfo | null): { value: string; label: string }[] {
  const base = { value: NO_FLAVOR, label: NO_FLAVOR };
  if (!info) return [base];
  return [base, ...info.flavors.map((f) => ({ value: f, label: f }))];
}

function assembleTaskNameLabel(flavor: string, buildType: string): string {
  const task = assembleTaskName(flavor === NO_FLAVOR ? null : flavor, buildType);
  return task.slice("assemble".length);
}

function LogPane({ page }: { page: { lines: string[]; dropped: number } }) {
  return (
    <div className="flex min-h-0 flex-col gap-1">
      <div className="max-h-64 min-h-16 overflow-y-auto rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[11px] leading-relaxed text-txt/90 [overflow-wrap:anywhere]">
        {page.lines.length === 0 ? (
          <p className="text-muted/60">no output yet</p>
        ) : (
          <pre className="whitespace-pre-wrap">{page.lines.join("\n")}</pre>
        )}
      </div>
      <p className="text-[10px] text-muted/70">{logFootnote(page)}</p>
    </div>
  );
}
