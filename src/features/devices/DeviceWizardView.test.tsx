import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DeviceWizardView } from "./DeviceWizardView";
import type { WizardModel } from "./deviceTiers";

const model = (patch: Partial<WizardModel>): WizardModel => ({
  title: "SM-S911B",
  meta: "Android 14 · R5CT91",
  state: { label: "Connected", tone: "ok" },
  banner: null,
  canCapture: true,
  cards: [
    { tier: "basic", title: "Basic", state: "ready", detail: "basic detail", action: null },
    { tier: "user_ca", title: "HTTPS for your debug builds", state: "action", detail: "user detail", action: "steps" },
    { tier: "full", title: "Full capture", state: "locked", detail: "full detail", action: "why" },
  ],
  ...patch,
});

const render = (m: WizardModel, patch: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <DeviceWizardView
      model={m}
      openCard={null}
      capturing={false}
      busy={false}
      onAction={() => {}}
      onCapture={() => {}}
      onDoctor={() => {}}
      {...patch}
    />,
  );

describe("DeviceWizardView", () => {
  it("shows the stock phone tiers with their actions", () => {
    const html = render(model({}));
    expect(html).toContain("Full capture");
    expect(html).toContain(">Show steps</button>");
    expect(html).toContain(">Why root</button>");
    expect(html).toContain("proxy setting is restored");
  });

  it("shows the unlock button for a rooted phone", () => {
    const m = model({});
    m.cards[2] = { ...m.cards[2]!, state: "action", action: "unlock" };
    expect(render(m)).toContain(">Unlock</button>");
  });

  it("shows the banner and disables capture for an unauthorized phone", () => {
    const html = render(
      model({ banner: "Unlock the phone", canCapture: false, state: { label: "Unauthorized", tone: "warn" } }),
    );
    expect(html).toContain("Unlock the phone");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Start capture<\/button>/);
  });

  it("shows the manual steps and the config snippet when expanded", () => {
    const html = render(model({}), { openCard: "user_ca" });
    expect(html).toContain("CA certificate");
    expect(html).toContain("network-security-config");
  });
});
