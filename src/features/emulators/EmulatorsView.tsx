import { useEffect, useState } from "react";
import { CircleCheck, CircleDashed, Download, MonitorSmartphone, Play, Plus, RefreshCw, Rocket, Stethoscope } from "lucide-react";
import { invoke } from "../../lib/tauri";
import { qError } from "../../lib/query";
import {
  useAvdsQuery,
  useImagesQuery,
  useInvalidateEmulators,
  useProfilesQuery,
} from "../../queries/emulators";
import { Badge, Panel } from "../../components/ui/primitives";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { useTraffic } from "../../store/traffic";
import { DoctorPanel } from "./DoctorPanel";

interface HostCheckLite {
  status: "ok" | "warn" | "fail";
  title: string;
  detail: string;
}

export function EmulatorsView() {
  const setInstallLog = useTraffic((s) => s.setInstallLog);
  const installLog = useTraffic((s) => s.installLog);
  const setOnboarding = useTraffic((s) => s.setOnboarding);
  const setSetupOpen = useTraffic((s) => s.setSetupOpen);
  const avdsQ = useAvdsQuery();
  const imagesQ = useImagesQuery();
  const profilesQ = useProfilesQuery();
  const refresh = useInvalidateEmulators();
  const avds = avdsQ.data ?? [];
  const images = imagesQ.data ?? [];
  const profiles = profilesQ.data ?? [];
  const [actionError, setActionError] = useState<string | null>(null);
  const busy = avdsQ.isPending || imagesQ.isPending || profilesQ.isPending;
  const [installing, setInstalling] = useState<string | null>(null);
  const [doctor, setDoctor] = useState<{ avdName: string; serial: string } | null>(null);
  const [hostReady, setHostReady] = useState<boolean | null>(null);
  const [hostIssues, setHostIssues] = useState<HostCheckLite[] | null>(null);

  const [name, setName] = useState("Beholder_Dev");
  const [imagePkg, setImagePkg] = useState<string>("");
  const [profile, setProfile] = useState<string>("");

  const anyQueryError = avdsQ.isError || imagesQ.isError || profilesQ.isError;
  const queryError = [avdsQ, imagesQ, profilesQ]
    .map((q) => qError(q.error))
    .find((e): e is string => e != null) ?? null;

  useEffect(() => {
    setImagePkg((cur) => cur || images[0]?.pkg || "");
  }, [imagesQ.data]);

  useEffect(() => {
    setProfile((cur) => cur || profiles.find((p) => p === "pixel_9_pro") || profiles[0] || "");
  }, [profilesQ.data]);

  useEffect(() => {
    if (!anyQueryError) {
      setHostReady((cur) => (cur === false ? true : cur));
      return;
    }
    let cancelled = false;
    (async () => {
      const checks = await invoke<HostCheckLite[]>("run_host_doctor").catch(() => null);
      if (cancelled) return;
      if (checks && checks.some((c) => c.status === "fail")) {
        setHostReady(false);
        setHostIssues(checks.filter((c) => c.status === "fail"));
      } else {
        setHostReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [anyQueryError]);

  async function openDoctor(avdName: string) {
    setActionError(null);
    try {
      const serial = await invoke<string>("resolve_serial_for_avd", { name: avdName });
      setDoctor({ avdName, serial });
    } catch (e) {
      setActionError(String(e));
    }
  }

  async function launch(avdName: string) {
    try {
      await invoke("launch_avd", { name: avdName });
      setOnboarding({ avdName, createdNew: false });
      setTimeout(() => void refresh(), 1500);
    } catch (e) {
      setActionError(String(e));
    }
  }

  async function install(pkg: string) {
    setInstalling(pkg);
    setInstallLog("starting...");
    try {
      await invoke("install_image", { pkg });
      setInstalling(null);
      await refresh();
    } catch (e) {
      setActionError(String(e));
      setInstalling(null);
    }
  }

  async function createAndLaunch() {
    if (!name.trim() || !imagePkg || !profile) return;
    setActionError(null);
    try {
      const selected = images.find((i) => i.pkg === imagePkg);
      if (selected && !selected.installed) {
        setInstalling(imagePkg);
        setInstallLog("starting...");
        await invoke("install_image", { pkg: imagePkg });
        setInstalling(null);
      }
      await invoke("create_avd", { name: name.trim(), pkg: imagePkg, profile });
      await invoke("launch_avd", { name: name.trim() });

      setOnboarding({ avdName: name.trim(), createdNew: true });
      await refresh();
    } catch (e) {
      setActionError(String(e));
      setInstalling(null);
    }
  }

  const selectedImage = images.find((i) => i.pkg === imagePkg);

  if (hostReady === false) {
    const failing = (hostIssues ?? []).map((c) => c.title).join(", ");
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
        <MonitorSmartphone size={28} className="text-muted" />
        <p className="text-sm font-semibold text-txt">Set up your Android environment</p>
        <p className="text-[12px] leading-relaxed text-muted">
          Beholder needs the Android SDK tooling to manage emulators. Missing: {failing}.
        </p>
        <details className="w-full rounded-md border border-line bg-surface px-3 py-2 text-left">
          <summary className="cursor-pointer text-[11px] text-muted">Details</summary>
          <ul className="mt-1.5 flex flex-col gap-1">
            {(hostIssues ?? []).map((c) => (
              <li key={c.title} className="break-all font-mono text-[10px] text-muted">
                {c.title}: {c.detail}
              </li>
            ))}
          </ul>
        </details>
        <Button variant="primary" onClick={() => setSetupOpen(true)}>
          Open setup
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 overflow-y-auto p-6">
      <h1 className="text-sm font-semibold text-txt">Emulators</h1>

      <Panel className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-medium text-txt">Your AVDs</p>
          <Button variant="ghost" size="sm" onClick={refresh} disabled={busy}>
            <RefreshCw size={14} className={busy ? "animate-spin" : ""} /> Refresh
          </Button>
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          {avds.length === 0 && (
            <div className="mt-3 flex flex-col items-center gap-2 rounded-md border border-dashed border-line px-3 py-5">
              <p className="text-[12px] font-medium text-txt">No emulators yet</p>
              <p className="text-[11px] text-muted">
                Beholder picks a rootable image and applies the right settings automatically.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  document
                    .getElementById("create-avd")
                    ?.scrollIntoView({ behavior: "smooth", block: "center" });
                  document.getElementById("create-avd-name")?.focus();
                }}
                className="border-accent/50! text-accent! hover:bg-accent/10! hover:text-accent!"
              >
                <Plus size={14} /> Create emulator
              </Button>
            </div>
          )}
          {avds.map((avd) => (
            <div
              key={avd.name}
              className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-mono text-[12px] text-txt">{avd.name}</span>
                <span className="truncate text-[11px] text-muted">
                  {avd.device ?? "?"} · API {avd.api_level ?? "?"} · {avd.image_tag ?? "?"}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {avd.beholder_ready ? (
                  <Badge tone="ok">rootable</Badge>
                ) : (
                  <Badge tone="danger">no root</Badge>
                )}
                {avd.running ? (
                  <>
                    <Badge tone="accent">running</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openDoctor(avd.name)}
                      title="Diagnose and repair this emulator"
                    >
                      <Stethoscope size={14} /> Doctor
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => launch(avd.name)}>
                    <Play size={14} /> Launch
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {doctor ? (
        <DoctorPanel avdName={doctor.avdName} serial={doctor.serial} onClose={() => setDoctor(null)} />
      ) : (
      <Panel className="p-4" >
        <div id="create-avd">
          <p className="text-[12px] font-medium text-txt">Create emulator</p>
        </div>
        <div className="mt-2 max-w-xl rounded-md border border-line bg-bg p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted/70">
            Beholder requirements — applied automatically
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            <li className="flex items-center gap-1.5 text-[11px] text-muted">
              <CircleCheck size={12} className="shrink-0 text-ok" />
              <code className="font-mono text-txt/80">google_apis</code> image — allows adb root (Play images refuse it)
            </li>
            <li className="flex items-center gap-1.5 text-[11px] text-muted">
              <CircleCheck size={12} className="shrink-0 text-ok" />
              <code className="font-mono text-txt/80">arm64-v8a</code> — matches your Apple Silicon Mac
            </li>
            <li className="flex items-center gap-1.5 text-[11px] text-muted">
              <CircleCheck size={12} className="shrink-0 text-ok" />
              System CA into Conscrypt apex + proxy — installed on every capture start
            </li>
          </ul>
        </div>
        <div className="mt-3 grid max-w-xl grid-cols-2 gap-3">
          <Input
            id="create-avd-name"
            label="Name"
            mono
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Select
            label="Device profile"
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
          >
            {profiles.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
          <div className="col-span-2">
            <Select
              label="System image (google_apis · arm64-v8a)"
              value={imagePkg}
              onChange={(e) => setImagePkg(e.target.value)}
            >
              {images.map((img) => (
                <option key={img.pkg} value={img.pkg}>
                  API {img.api} · {img.tag} {img.installed ? "· installed" : "· needs download"}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {selectedImage && !selectedImage.installed && (
          <div className="mt-3 rounded-md border border-line bg-bg p-2.5">
            {installing === selectedImage.pkg ? (
              <div className="flex items-center gap-2 text-[11px] text-muted">
                <CircleDashed size={13} className="animate-spin text-accent" />
                <span className="truncate font-mono">{installLog ?? "downloading..."}</span>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 text-[11px] text-warn">
                  Image not installed — downloading ~1-2 GB is required before creating.
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => install(selectedImage.pkg)}
                  className="shrink-0"
                >
                  <Download size={14} /> Install now
                </Button>
              </div>
            )}
          </div>
        )}
        <div className="mt-3 flex items-center gap-2">
          <Button
            variant="primary"
            icon={Rocket}
            disabled={busy || installing != null || !name.trim() || !imagePkg || !profile}
            onClick={createAndLaunch}
          >
            Create &amp; Launch
          </Button>
        </div>
        {(actionError ?? queryError) && <ErrorBox message={actionError ?? queryError ?? ""} className="mt-3" />}
      </Panel>
      )}
    </div>
  );
}
