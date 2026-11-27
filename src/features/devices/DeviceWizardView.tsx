import clsx from "clsx";
import { CircleCheck, CircleDashed, Copy, Lock } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Select";
import { Badge } from "../../components/ui/primitives";
import { toast } from "../../components/ui/toast";
import type { TierId } from "../../store/types";
import type { CardAction, CompanionState, WizardCard, WizardModel } from "./deviceTiers";

export const NETWORK_SECURITY_CONFIG = `<network-security-config>
    <debug-overrides>
        <trust-anchors>
            <certificates src="user" />
        </trust-anchors>
    </debug-overrides>
</network-security-config>`;

const ACTION_LABEL: Record<CardAction, string> = {
  steps: "Show steps",
  why: "Why root",
  unlock: "Unlock",
};

const STATE_ICON = { ready: CircleCheck, action: CircleDashed, locked: Lock } as const;
const STATE_CLS = { ready: "text-ok", action: "text-warn", locked: "text-muted" } as const;

function UserCaSteps() {
  async function copy() {
    try {
      await navigator.clipboard.writeText(NETWORK_SECURITY_CONFIG);
      toast("Config copied to clipboard");
    } catch {
      toast("Clipboard unavailable", "danger");
    }
  }
  return (
    <div className="mt-2 flex flex-col gap-2 text-[12px] text-muted">
      <ol className="list-decimal pl-4">
        <li>The certificate is in the Downloads folder as beholder-ca.crt.</li>
        <li>
          On the phone open Settings, search for CA certificate, and install it. Android only allows
          this by hand.
        </li>
        <li>
          Add res/xml/network_security_config.xml to your debug build, reference it with
          android:networkSecurityConfig in the manifest, and rebuild.
        </li>
      </ol>
      <pre className="overflow-x-auto rounded-[8px] bg-surface-2 p-2 font-mono text-[11px] text-txt">
        {NETWORK_SECURITY_CONFIG}
      </pre>
      <Button size="sm" icon={Copy} className="self-start" onClick={() => void copy()}>
        Copy config
      </Button>
    </div>
  );
}

function WhyRoot() {
  return (
    <p className="mt-2 text-[12px] text-muted">
      Android apps trust only system certificates unless their build opts in. Writing to the system
      store needs root. With Magisk, Beholder mounts its certificate there until the next reboot; it
      changes nothing permanently. Rooting a phone is your decision and Beholder does not do it.
    </p>
  );
}

function Card({
  card,
  open,
  busy,
  onAction,
}: {
  card: WizardCard;
  open: boolean;
  busy: boolean;
  onAction: (tier: TierId, action: CardAction) => void;
}) {
  const Icon = STATE_ICON[card.state];
  return (
    <section className="rounded-[var(--radius-lg)] border border-line bg-surface p-3">
      <div className="flex items-start gap-3">
        <Icon size={18} className={clsx("mt-0.5 shrink-0", STATE_CLS[card.state])} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-txt">{card.title}</h3>
          <p className="text-[12px] text-muted">{card.detail}</p>
        </div>
        {card.action && (
          <Button
            size="sm"
            variant={card.action === "unlock" ? "primary" : "ghost"}
            disabled={busy}
            onClick={() => onAction(card.tier, card.action as CardAction)}
          >
            {ACTION_LABEL[card.action]}
          </Button>
        )}
      </div>
      {open && card.tier === "user_ca" && <UserCaSteps />}
      {open && card.tier === "full" && <WhyRoot />}
    </section>
  );
}

function CompanionCard({
  state,
  apps,
  selectedApp,
  disabled,
  onSelectApp,
  onInstall,
  onGet,
}: {
  state: CompanionState;
  apps: string[];
  selectedApp: string | null;
  disabled: boolean;
  onSelectApp: (packageName: string | null) => void;
  onInstall: () => void;
  onGet: () => void;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-line bg-surface p-3">
      <h3 className="text-[13px] font-semibold text-txt">Capture one app</h3>
      {state === "ready" ? (
        <div className="mt-2">
          <Select
            label="App"
            value={selectedApp ?? ""}
            disabled={disabled}
            onChange={(e) => onSelectApp(e.target.value || null)}
          >
            <option value="">Whole phone</option>
            {apps.map((app) => (
              <option key={app} value={app}>
                {app}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <>
          <p className="text-[12px] text-muted">
            {state === "outdated"
              ? "The companion on this phone is old. Install version 0.3.0 or newer."
              : "Install the Beholder companion app to capture one app and leave the rest of the phone alone."}
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" disabled={disabled} onClick={onGet}>
              Get companion
            </Button>
            <Button size="sm" disabled={disabled} onClick={onInstall}>
              Install APK
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

export function DeviceWizardView({
  model,
  openCard,
  capturing,
  busy,
  onAction,
  onCapture,
  onDoctor,
  apps,
  selectedApp,
  onSelectApp,
  onInstallCompanion,
  onGetCompanion,
}: {
  model: WizardModel;
  openCard: TierId | null;
  capturing: boolean;
  busy: boolean;
  onAction: (tier: TierId, action: CardAction) => void;
  onCapture: () => void;
  onDoctor: () => void;
  apps: string[];
  selectedApp: string | null;
  onSelectApp: (packageName: string | null) => void;
  onInstallCompanion: () => void;
  onGetCompanion: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <header>
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold text-txt">{model.title}</h2>
          <Badge tone={model.state.tone}>{model.state.label}</Badge>
        </div>
        <p className="text-[12px] text-muted">{model.meta}</p>
      </header>

      {model.banner && (
        <p className="rounded-[8px] bg-warn/14 px-3 py-2 text-[12px] text-warn">{model.banner}</p>
      )}

      {model.cards.map((card) => (
        <Card
          key={card.tier}
          card={card}
          open={openCard === card.tier}
          busy={busy}
          onAction={onAction}
        />
      ))}

      {model.companion && (
        <CompanionCard
          state={model.companion}
          apps={apps}
          selectedApp={selectedApp}
          disabled={busy || capturing}
          onSelectApp={onSelectApp}
          onInstall={onInstallCompanion}
          onGet={onGetCompanion}
        />
      )}

      <footer className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-[300px] text-[11px] text-muted">
          {model.companion === "ready" && selectedApp
            ? "Capture goes through adb reverse. Only the selected app uses the proxy."
            : "Capture goes through adb reverse. Your proxy setting is restored on stop."}
        </p>
        <div className="flex gap-2">
          <Button size="sm" disabled={!model.canCapture} onClick={onDoctor}>
            Run doctor
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!model.canCapture || capturing || busy}
            onClick={onCapture}
          >
            {capturing ? "Capturing" : "Start capture"}
          </Button>
        </div>
      </footer>
    </div>
  );
}
