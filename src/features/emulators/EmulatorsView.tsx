import { useEffect, useState } from "react";
import { CircleDashed, Download, Play, RefreshCw, Rocket } from "lucide-react";
import { invoke } from "../../lib/tauri";
import type { AvdInfo, SystemImage } from "../../store/types";
import { Badge, Panel } from "../../components/ui/primitives";
import { useTraffic } from "../../store/traffic";
import { OnboardingPanel } from "./OnboardingPanel";

interface OnboardingTarget {
  avdName: string;
  createdNew: boolean;
}

export function EmulatorsView() {
  const setInstallLog = useTraffic((s) => s.setInstallLog);
  const installLog = useTraffic((s) => s.installLog);
  const [avds, setAvds] = useState<AvdInfo[]>([]);
  const [images, setImages] = useState<SystemImage[]>([]);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingTarget | null>(null);

  const [name, setName] = useState("Beholder_Dev");
  const [imagePkg, setImagePkg] = useState<string>("");
  const [profile, setProfile] = useState<string>("");

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const [avdList, imgList, profileList] = await Promise.all([
        invoke<AvdInfo[]>("list_avds"),
        invoke<SystemImage[]>("list_images"),
        invoke<string[]>("list_device_profiles"),
      ]);
      setAvds(avdList);
      setImages(imgList);
      setProfiles(profileList);
      setImagePkg((cur) => cur || imgList[0]?.pkg || "");
      setProfile((cur) => cur || profileList.find((p) => p === "pixel_9_pro") || profileList[0] || "");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function launch(avdName: string) {
    try {
      await invoke("launch_avd", { name: avdName });
      setOnboarding({ avdName, createdNew: false });
      setTimeout(refresh, 1500);
    } catch (e) {
      setError(String(e));
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
      setError(String(e));
      setInstalling(null);
    }
  }

  async function createAndLaunch() {
    if (!name.trim() || !imagePkg || !profile) return;
    setBusy(true);
    setError(null);
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
      setError(String(e));
      setInstalling(null);
    } finally {
      setBusy(false);
    }
  }

  const selectedImage = images.find((i) => i.pkg === imagePkg);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <h1 className="text-sm font-semibold text-txt">Emulators</h1>

      <Panel className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-medium text-txt">Your AVDs</p>
          <button
            type="button"
            onClick={refresh}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[12px] text-muted hover:text-txt disabled:opacity-40"
          >
            <RefreshCw size={12} className={busy ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          {avds.length === 0 && (
            <p className="text-[12px] text-muted">No AVDs found — create one below.</p>
          )}
          {avds.map((avd) => (
            <div
              key={avd.name}
              className="flex items-center justify-between rounded-md border border-line px-3 py-2"
            >
              <div className="min-w-0">
                <span className="font-mono text-[12px] text-txt">{avd.name}</span>
                <span className="ml-2 text-[11px] text-muted">
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
                  <Badge tone="accent">running</Badge>
                ) : (
                  <button
                    type="button"
                    onClick={() => launch(avd.name)}
                    className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-muted hover:text-accent"
                  >
                    <Play size={11} /> Launch
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {onboarding ? (
        <OnboardingPanel
          avdName={onboarding.avdName}
          createdNew={onboarding.createdNew}
          onCancel={() => setOnboarding(null)}
        />
      ) : (
      <Panel className="p-4">
        <p className="text-[12px] font-medium text-txt">Create emulator</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          Recommended: newest <code className="font-mono">google_apis</code> image for arm64 — Google Play
          images refuse <code className="font-mono">adb root</code> and cannot be inspected by Beholder.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-7 rounded-md border border-line bg-bg px-2 font-mono text-[12px] text-txt focus:border-accent focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">Device profile</span>
            <select
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              className="h-7 rounded-md border border-line bg-bg px-2 font-mono text-[12px] text-txt focus:border-accent focus:outline-none"
            >
              {profiles.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-[11px] text-muted">System image (google_apis · arm64-v8a)</span>
            <select
              value={imagePkg}
              onChange={(e) => setImagePkg(e.target.value)}
              className="h-7 rounded-md border border-line bg-bg px-2 font-mono text-[12px] text-txt focus:border-accent focus:outline-none"
            >
              {images.map((img) => (
                <option key={img.pkg} value={img.pkg}>
                  API {img.api} · {img.tag} {img.installed ? "· installed" : "· needs download"}
                </option>
              ))}
            </select>
          </label>
        </div>
        {selectedImage && !selectedImage.installed && (
          <div className="mt-3 rounded-md border border-line bg-bg p-2.5">
            {installing === selectedImage.pkg ? (
              <div className="flex items-center gap-2 text-[11px] text-muted">
                <CircleDashed size={13} className="animate-spin text-accent" />
                <span className="truncate font-mono">{installLog ?? "downloading..."}</span>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-warn">
                  Image not installed — downloading ~1-2 GB is required before creating.
                </span>
                <button
                  type="button"
                  onClick={() => install(selectedImage.pkg)}
                  className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-muted hover:text-accent"
                >
                  <Download size={11} /> Install now
                </button>
              </div>
            )}
          </div>
        )}
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={busy || installing != null || !name.trim() || !imagePkg || !profile}
            onClick={createAndLaunch}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg disabled:opacity-40"
          >
            <Rocket size={13} /> Create &amp; Launch
          </button>
        </div>
        {error && (
          <p className="mt-3 whitespace-pre-wrap rounded-md border border-danger/40 bg-danger/10 p-2 text-[12px] text-danger">
            {error}
          </p>
        )}
      </Panel>
      )}
    </div>
  );
}
