import type { Device, DeviceReport, TierId, TierState } from "../../store/types";

export type CardAction = "steps" | "why" | "unlock";
export type StateTone = "ok" | "warn" | "danger";

export interface WizardCard {
  tier: TierId;
  title: string;
  state: TierState;
  detail: string;
  action: CardAction | null;
}

export interface WizardModel {
  title: string;
  meta: string;
  state: { label: string; tone: StateTone };
  banner: string | null;
  canCapture: boolean;
  cards: WizardCard[];
}

const TIERS: { tier: TierId; title: string }[] = [
  { tier: "basic", title: "Basic" },
  { tier: "user_ca", title: "HTTPS for your debug builds" },
  { tier: "full", title: "Full capture" },
];

function deviceState(device: Device | null): Pick<WizardModel, "state" | "banner"> {
  if (!device) {
    return {
      state: { label: "Disconnected", tone: "danger" },
      banner: "adb no longer sees this phone. Reconnect the cable.",
    };
  }
  switch (device.state) {
    case "Online":
      return { state: { label: "Connected", tone: "ok" }, banner: null };
    case "Unauthorized":
      return {
        state: { label: "Unauthorized", tone: "warn" },
        banner: "Unlock the phone and accept the USB debugging prompt.",
      };
    default:
      return {
        state: { label: "Offline", tone: "warn" },
        banner: "adb reports this phone as offline. Reconnect the cable.",
      };
  }
}

function actionFor(tier: TierId, state: TierState): CardAction | null {
  if (state === "ready") return null;
  if (tier === "user_ca") return "steps";
  if (tier === "full") return state === "locked" ? "why" : "unlock";
  return null;
}

export function wizardModel(
  serial: string,
  device: Device | null,
  report: DeviceReport | null,
): WizardModel {
  const { state, banner } = deviceState(device);
  const online = device?.state === "Online";
  const probe = online ? report?.probe : undefined;
  const cards = TIERS.map(({ tier, title }) => {
    if (!online) {
      return {
        tier,
        title,
        state: "locked" as const,
        detail: "Available after the phone is connected and authorized.",
        action: null,
      };
    }
    const status = report?.tiers.find((t) => t.tier === tier);
    if (!status) {
      return { tier, title, state: "locked" as const, detail: "Checking the phone…", action: null };
    }
    return {
      tier,
      title,
      state: status.state,
      detail: status.detail,
      action: actionFor(tier, status.state),
    };
  });
  return {
    title: probe?.model ?? device?.model ?? serial,
    meta: probe ? `Android ${probe.android_release} · ${serial}` : serial,
    state,
    banner,
    canCapture: online,
    cards,
  };
}
