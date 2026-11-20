import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { View } from "../../store/traffic";

vi.stubGlobal("window", {});
vi.stubGlobal(
  "localStorage",
  (() => {
    const store = new Map<string, string>();
    return {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  })(),
);

const { CommandBar } = await import("./CommandBar");
const { useTraffic } = await import("../../store/traffic");

type TrafficState = ReturnType<typeof useTraffic.getState>;

function setStore(patch: Partial<TrafficState>) {
  useTraffic.setState(patch);
  Object.assign(useTraffic.getInitialState(), patch);
}

function render() {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <CommandBar />
    </QueryClientProvider>,
  );
}

const ALL_VIEWS: View[] = [
  "requests",
  "websockets",
  "metrics",
  "emulators",
  "apks",
  "database",
  "console",
];

beforeEach(() => {
  setStore({
    activeView: "requests",
    captureOn: false,
    capturePort: null,
    metro: null,
    targetSerial: null,
    targetAvd: null,
  });
});

describe("CommandBar", () => {
  it("shows the device target, capture control and command field in every view", () => {
    for (const view of ALL_VIEWS) {
      setStore({ activeView: view });
      const html = render();
      expect(html, view).toContain('title="Select emulator target"');
      expect(html, view).toContain(">Capture</button>");
      expect(html, view).toContain("Search or run a command");
    }
  });

  it("disables capture until a running target is selected", () => {
    expect(render()).toMatch(/<button[^>]*disabled=""[^>]*title="Select a running emulator first"/);
    setStore({ targetSerial: "emulator-5554", targetAvd: "Pixel_8_API_35" });
    const html = render();
    expect(html).toContain("Pixel_8_API_35");
    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*title="Start capture"/);
  });

  it("replaces the capture button with a live pill and health summary while capturing", () => {
    setStore({
      captureOn: true,
      capturePort: 8080,
      metro: { detected: true, port: 8081 },
      targetSerial: "emulator-5554",
      targetAvd: "Pixel_8_API_35",
    });
    const html = render();
    expect(html).toContain("Capturing");
    expect(html).toContain("00:00");
    expect(html).toContain('aria-label="Stop capture"');
    expect(html).not.toContain(">Capture</button>");
    expect(html).toContain("Proxy :8080, Metro :8081, checking health");
    expect(html).toContain('title="Capture doctor"');
  });

  it("no longer renders request counters or a sidebar toggle", () => {
    const html = render();
    expect(html).not.toMatch(/\d+ req</);
    expect(html).not.toContain("sidebar");
  });
});
