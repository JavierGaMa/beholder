import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { invoke } from "../../lib/tauri";
import type { AvdInfo } from "../../store/types";
import { Badge } from "../../components/ui/primitives";
import { Button } from "../../components/ui/Button";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { DoctorPanel } from "./DoctorPanel";

function Facts({ avd }: { avd: AvdInfo }) {
  const image = [avd.image_tag, avd.abi].filter(Boolean).join(" ") || "?";
  const cells = [
    { label: "Device", value: avd.device ?? "?" },
    { label: "Android", value: `API ${avd.api_level ?? "?"}` },
    { label: "Image", value: image },
  ];
  return (
    <div className="grid grid-cols-3 overflow-hidden rounded-[var(--radius-md)] bg-surface-2">
      {cells.map((c, i) => (
        <div key={c.label} className={i > 0 ? "border-l border-line px-3 py-2.5" : "px-3 py-2.5"}>
          <p className="text-[11px] text-muted">{c.label}</p>
          <p className="mt-0.5 truncate font-mono text-[12px] text-txt" title={c.value}>
            {c.value}
          </p>
        </div>
      ))}
    </div>
  );
}

export function EmulatorDetail({
  avd,
  onLaunch,
}: {
  avd: AvdInfo;
  onLaunch: (name: string) => void;
}) {
  const [resolved, setResolved] = useState<{ name: string; serial: string } | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const serial = avd.serial ?? (resolved?.name === avd.name ? resolved.serial : null);

  useEffect(() => {
    if (!avd.running || avd.serial) return;
    let cancelled = false;
    setResolveError(null);
    invoke<string>("resolve_serial_for_avd", { name: avd.name })
      .then((s) => {
        if (!cancelled) setResolved({ name: avd.name, serial: s });
      })
      .catch((e) => {
        if (!cancelled) setResolveError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [avd.name, avd.running, avd.serial]);

  if (avd.running && serial) {
    return <DoctorPanel key={serial} avdName={avd.name} serial={serial} facts={<Facts avd={avd} />} />;
  }

  return (
    <div className="flex flex-col">
      <div className="flex min-h-12 items-center gap-2">
        <span className="truncate font-mono text-[13px] font-semibold text-txt">{avd.name}</span>
        <span className="text-[12px] text-muted">{avd.running ? "running" : "stopped"}</span>
        <span className="flex-1" />
        {!avd.beholder_ready && <Badge tone="danger">no root</Badge>}
        {!avd.running && (
          <Button
            variant={avd.beholder_ready ? "primary" : "ghost"}
            size="sm"
            icon={Play}
            onClick={() => onLaunch(avd.name)}
          >
            Launch
          </Button>
        )}
      </div>
      <Facts avd={avd} />
      {avd.running && !resolveError && (
        <p className="mt-5 text-[12px] text-muted">Running diagnostics…</p>
      )}
      {resolveError && <ErrorBox message={resolveError} className="mt-5" />}
      {!avd.running && (
        <p className="mt-5 text-[12px] text-muted">
          {avd.beholder_ready
            ? "Launch this emulator to run its capture health checks."
            : "This image refuses adb root, so Beholder cannot capture from it."}
        </p>
      )}
    </div>
  );
}
