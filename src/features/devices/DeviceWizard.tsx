import { useEffect, useState } from "react";
import { invoke, openExternal, pickApk } from "../../lib/tauri";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { toast } from "../../components/ui/toast";
import { qError } from "../../lib/query";
import {
  useDeviceAppsQuery,
  useDeviceProbeQuery,
  useWatchedDevicesQuery,
} from "../../queries/deviceProbe";
import { useTraffic } from "../../store/traffic";
import type { TierId } from "../../store/types";
import { startCapture } from "../capture/startCapture";
import { DoctorPanel } from "../emulators/DoctorPanel";
import { DeviceWizardView } from "./DeviceWizardView";
import { capturableApps, wizardModel, type CardAction } from "./deviceTiers";
import { useDeviceWizard } from "./store";

const COMPANION_RELEASES = "https://github.com/JavierGaMa/BeholdersApk/releases";

function WizardBody({ serial }: { serial: string }) {
  const devicesQ = useWatchedDevicesQuery();
  const device = devicesQ.data?.find((d) => d.serial === serial) ?? null;
  const online = device?.state === "Online";
  const probeQ = useDeviceProbeQuery(serial, online);
  const captureOn = useTraffic((s) => s.captureOn);
  const isTarget = useTraffic((s) => s.targetSerial === serial);
  const targetPackage = useTraffic((s) => s.targetPackage);
  const setTargetPackage = useTraffic((s) => s.setTargetPackage);
  const appsQ = useDeviceAppsQuery(serial, online && probeQ.data?.companion_desktop === true);
  const [openCard, setOpenCard] = useState<TierId | null>(null);
  const [doctor, setDoctor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const model = wizardModel(serial, device, probeQ.data ?? null);
  const probeError = qError(probeQ.error);

  useEffect(() => {
    setError(null);
  }, [online]);

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function onAction(tier: TierId, action: CardAction) {
    setOpenCard((current) => (current === tier && action !== "unlock" ? null : tier));
    if (action === "unlock") {
      void run(async () => {
        await invoke("install_system_ca", { serial });
        toast("Certificate installed. Restart the app you want to inspect");
        await probeQ.refetch();
      });
    }
    if (action === "steps" && openCard !== tier) {
      void run(async () => {
        await invoke("push_user_ca", { serial });
        await invoke("open_security_settings", { serial });
      });
    }
  }

  return (
    <>
      <DeviceWizardView
        model={model}
        openCard={openCard}
        capturing={captureOn}
        busy={busy}
        onAction={onAction}
        onCapture={() => void run(() => startCapture(serial))}
        onDoctor={() => setDoctor((v) => !v)}
        apps={capturableApps(appsQ.data)}
        selectedApp={isTarget ? targetPackage : null}
        onSelectApp={setTargetPackage}
        onGetCompanion={() => void run(() => openExternal(COMPANION_RELEASES))}
        onInstallCompanion={() =>
          void run(async () => {
            const path = await pickApk();
            if (!path) return;
            await invoke("install_apk", { serial, path });
            await probeQ.refetch();
          })
        }
      />
      {(error ?? probeError) && (
        <div className="flex items-start gap-2 px-4 pb-4">
          <ErrorBox message={error ?? probeError ?? ""} className="flex-1" />
          <Button size="sm" onClick={() => void probeQ.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {doctor && online && <DoctorPanel avdName={model.title} serial={serial} facts={null} />}
    </>
  );
}

export function DeviceWizard() {
  const serial = useDeviceWizard((s) => s.serial);
  const close = useDeviceWizard((s) => s.close);
  return (
    <Modal open={serial != null} onClose={close} width={560} ariaLabel="Device setup" className="max-w-full!">
      {serial && <WizardBody key={serial} serial={serial} />}
    </Modal>
  );
}
