import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  ArrowLeft,
  CircleCheck,
  CircleDashed,
  Download,
  MonitorSmartphone,
  Play,
  Plus,
  RefreshCw,
  Rocket,
} from "lucide-react";
import { invoke } from "../../lib/tauri";
import { qError } from "../../lib/query";
import {
  useAvdsQuery,
  useImagesQuery,
  useInvalidateEmulators,
  useProfilesQuery,
} from "../../queries/emulators";
import { Badge } from "../../components/ui/primitives";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { useTraffic } from "../../store/traffic";
import type { SystemImage } from "../../store/types";
import { EmulatorDetail } from "./EmulatorDetail";
import { avdSummary, resolveSelectedAvd } from "./emulatorSelection";

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
  const targetSerial = useTraffic((s) => s.targetSerial);
  const targetAvd = useTraffic((s) => s.targetAvd);
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
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
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

  async function launch(avdName: string) {
    setActionError(null);
    try {
      await invoke("launch_avd", { name: avdName });
      setOnboarding({ avdName, createdNew: false });
      setTimeout(() => void refresh(), 1500);
    } catch (e) {
      setActionError(String(e));
    }
  }

  async function install(pkg: string) {
    setActionError(null);
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
      setSelectedName(name.trim());
      setCreating(false);
      await refresh();
    } catch (e) {
      setActionError(String(e));
      setInstalling(null);
    }
  }

  function openCreate() {
    setCreating(true);
    requestAnimationFrame(() => document.getElementById("create-avd-name")?.focus());
  }

  const selectedImage = images.find((i) => i.pkg === imagePkg);
  const selectedAvd = resolveSelectedAvd(avds, selectedName, targetSerial, targetAvd);
  const showCreate = creating || selectedAvd == null;
  const viewError = actionError ?? queryError;

  if (hostReady === false) {
    const failing = (hostIssues ?? []).map((c) => c.title).join(", ");
    return (
      <div className="panel flex h-full flex-col items-center justify-center p-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <MonitorSmartphone size={28} className="text-muted" />
          <p className="text-sm font-semibold text-txt">Set up your Android environment</p>
          <p className="text-[12px] leading-relaxed text-muted">
            Beholder needs the Android SDK tooling to manage emulators. Missing: {failing}.
          </p>
          <details className="w-full rounded-[var(--radius-md)] bg-surface-2 px-3 py-2 text-left">
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
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {viewError && <ErrorBox message={viewError} className="shrink-0" />}
      <div className="flex min-h-0 flex-1 gap-2">
        <section className="panel flex w-[360px] shrink-0 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-2 px-4">
            <p className="text-[13px] font-semibold text-txt">Emulators</p>
            <span className="text-[12px] text-muted">{avds.length}</span>
            <span className="flex-1" />
            <Button
              variant="ghost"
              size="icon"
              onClick={refresh}
              disabled={busy}
              title="Refresh"
              aria-label="Refresh"
            >
              <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
            </Button>
            <Button variant="ghost" size="sm" icon={Plus} onClick={openCreate}>
              New emulator
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {avds.length === 0 && (
              <div className="m-2 flex flex-col items-center gap-2 rounded-[var(--radius-md)] bg-surface-2 px-3 py-5 text-center">
                <p className="text-[12px] font-medium text-txt">No emulators yet</p>
                <p className="text-[11px] text-muted">
                  Beholder picks a rootable image and applies the right settings automatically.
                </p>
                <Button variant="ghost" size="sm" icon={Plus} onClick={openCreate}>
                  Create emulator
                </Button>
              </div>
            )}
            <ul className="flex flex-col gap-0.5">
              {avds.map((avd) => {
                const active = !showCreate && selectedAvd?.name === avd.name;
                return (
                  <li
                    key={avd.name}
                    className={clsx(
                      "flex h-[52px] items-center gap-2 rounded-[var(--radius-md)] pr-2 transition-colors",
                      active ? "bg-accent/10 shadow-[inset_0_0_0_1px_var(--line)]" : "hover:bg-surface-2",
                    )}
                  >
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setSelectedName(avd.name);
                        setCreating(false);
                      }}
                      className="focus-ring flex h-full min-w-0 flex-1 flex-col justify-center rounded-[var(--radius-md)] pl-3 text-left"
                    >
                      <span className="truncate font-mono text-[12px] font-semibold text-txt">
                        {avd.name}
                      </span>
                      <span className="truncate font-mono text-[11px] text-muted">
                        {avdSummary(avd)}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {avd.running && <Badge tone="accent">running</Badge>}
                      {!avd.beholder_ready && <Badge tone="danger">no root</Badge>}
                      {!avd.running && avd.beholder_ready && (
                        <Button variant="ghost" size="sm" icon={Play} onClick={() => launch(avd.name)}>
                          Launch
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          <p className="shrink-0 border-t border-line px-4 py-3 text-[12px] leading-relaxed text-muted">
            Play Store images refuse adb root, so Beholder cannot capture from them.
          </p>
        </section>

        <section className="panel flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="max-w-3xl px-5 pb-5 pt-1">
              {showCreate || selectedAvd == null ? (
                <CreateForm
                  canGoBack={selectedAvd != null}
                  onBack={() => setCreating(false)}
                  name={name}
                  setName={setName}
                  profile={profile}
                  setProfile={setProfile}
                  profiles={profiles}
                  imagePkg={imagePkg}
                  setImagePkg={setImagePkg}
                  images={images}
                  imagesLoading={imagesQ.isPending}
                  selectedImage={selectedImage}
                  installing={installing}
                  installLog={installLog}
                  busy={busy}
                  onInstall={install}
                  onCreate={createAndLaunch}
                />
              ) : (
                <EmulatorDetail avd={selectedAvd} onLaunch={launch} />
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function CreateForm({
  canGoBack,
  onBack,
  name,
  setName,
  profile,
  setProfile,
  profiles,
  imagePkg,
  setImagePkg,
  images,
  imagesLoading,
  selectedImage,
  installing,
  installLog,
  busy,
  onInstall,
  onCreate,
}: {
  canGoBack: boolean;
  onBack: () => void;
  name: string;
  setName: (v: string) => void;
  profile: string;
  setProfile: (v: string) => void;
  profiles: string[];
  imagePkg: string;
  setImagePkg: (v: string) => void;
  images: SystemImage[];
  imagesLoading: boolean;
  selectedImage: SystemImage | undefined;
  installing: string | null;
  installLog: string | null;
  busy: boolean;
  onInstall: (pkg: string) => void;
  onCreate: () => void;
}) {
  return (
    <div id="create-avd" className="flex flex-col">
      <div className="flex min-h-12 items-center gap-2">
        {canGoBack && (
          <Button variant="ghost" size="icon" onClick={onBack} title="Back" aria-label="Back">
            <ArrowLeft size={14} />
          </Button>
        )}
        <p className="text-[13px] font-semibold text-txt">Create emulator</p>
      </div>
      <div className="max-w-xl rounded-[var(--radius-md)] bg-surface-2 p-3">
        <p className="text-[11px] font-medium text-muted">Beholder requirements, applied automatically</p>
        <ul className="mt-2 flex flex-col gap-1.5">
          <li className="flex items-center gap-1.5 text-[12px] text-muted">
            <CircleCheck size={12} className="shrink-0 text-ok" />
            <code className="font-mono text-txt/80">google_apis</code> image — allows adb root (Play images refuse it)
          </li>
          <li className="flex items-center gap-1.5 text-[12px] text-muted">
            <CircleCheck size={12} className="shrink-0 text-ok" />
            <code className="font-mono text-txt/80">arm64-v8a</code> — matches your Apple Silicon Mac
          </li>
          <li className="flex items-center gap-1.5 text-[12px] text-muted">
            <CircleCheck size={12} className="shrink-0 text-ok" />
            System CA into Conscrypt apex + proxy — installed on every capture start
          </li>
        </ul>
      </div>
      <div className="mt-4 grid max-w-xl grid-cols-2 gap-3">
        <Input
          id="create-avd-name"
          label="Name"
          mono
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Select label="Device profile" value={profile} onChange={(e) => setProfile(e.target.value)}>
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
          {!imagesLoading && images.length === 0 && (
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
              No rootable <code className="font-mono text-txt/80">google_apis</code> /{" "}
              <code className="font-mono text-txt/80">default</code> arm64-v8a images found. Install one
              with Android Studio SDK Manager (not Play Store), then refresh.
            </p>
          )}
        </div>
      </div>
      {selectedImage && !selectedImage.installed && (
        <div className="mt-3 max-w-xl rounded-[var(--radius-md)] bg-surface-2 p-3">
          {installing === selectedImage.pkg ? (
            <div className="flex items-center gap-2 text-[11px] text-muted">
              <CircleDashed size={13} className="animate-spin text-accent" />
              <span className="truncate font-mono">{installLog ?? "downloading..."}</span>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 text-[12px] text-warn">
                Image not installed — downloading ~1-2 GB is required before creating.
              </span>
              <Button
                variant="ghost"
                size="sm"
                icon={Download}
                onClick={() => onInstall(selectedImage.pkg)}
                className="shrink-0"
              >
                Install now
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="mt-4 flex items-center gap-2">
        <Button
          variant="primary"
          icon={Rocket}
          disabled={busy || installing != null || !name.trim() || !imagePkg || !profile}
          onClick={onCreate}
        >
          Create &amp; Launch
        </Button>
      </div>
    </div>
  );
}
