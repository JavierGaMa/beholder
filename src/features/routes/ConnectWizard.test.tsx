import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { DiscoveryResult } from "../../store/types";
import type { ConnectStep } from "./connectStore";

vi.stubGlobal("window", {});
vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});

const { ConnectWizard } = await import("./ConnectWizard");
const { useConnect } = await import("./connectStore");

const discovery: DiscoveryResult = {
  name: "local stack",
  address: "http://localhost:8090",
  files: [
    { id: "dev", label: "Dev", path: "/s/dev.json", hint: null, routes: 3, up: 2, error: null },
    { id: "staging", label: "Staging", path: "/s/staging.json", hint: "make staging", routes: 2, up: 0, error: null },
    { id: "broken", label: "Broken", path: "/s/broken.json", hint: null, routes: 0, up: 0, error: "invalid route file: nope" },
  ],
};

function render(step: ConnectStep, address = "http://localhost:8090") {
  useConnect.setState({ step, address });
  Object.assign(useConnect.getInitialState(), { step, address });
  return renderToStaticMarkup(<ConnectWizard />).replace(/&#x27;/g, "'");
}

const found = (selected: string | null, data = discovery): ConnectStep => ({
  kind: "found",
  discovery: data,
  selected,
  connecting: false,
});

const current = (html: string) => html.match(/aria-current="step"[^>]*>([^<]+)</)?.[1];

beforeEach(() => {
  useConnect.setState({ banner: null });
});

describe("ConnectWizard", () => {
  it("renders nothing while closed", () => {
    expect(render({ kind: "closed" })).toBe("");
  });

  it("shows the progress of a detection", () => {
    const html = render({ kind: "detecting", address: "http://localhost:8090/" });
    expect(html).toContain('role="dialog"');
    for (const label of ["1 Detect", "2 Choose", "3 Connect"]) expect(html).toContain(label);
    expect(current(html)).toBe("1 Detect");
    expect(html).toContain("Looking for local services…");
    expect(html).toContain("http://localhost:8090/.well-known/beholder-routes");
    expect(html).toContain("animate-spin");
    expect(html).toMatch(/>Cancel</);
  });

  it("lists the environments as a radio group", () => {
    const html = render(found("dev"));
    expect(current(html)).toBe("2 Choose");
    expect(html).toMatch(/>Found</);
    expect(html).toContain("local stack");
    expect(html).toContain("http://localhost:8090");
    expect(html).toContain(
      "Choose one environment. Environments can share the same paths, so connect one at a time.",
    );
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html.match(/<input[^>]*checked=""/g)).toHaveLength(1);
    expect(html.match(/<input[^>]*disabled=""/g)).toHaveLength(1);
    expect(html).toContain("/s/dev.json");
    expect(html).toContain("2 of 3 running");
    expect(html).toContain("0 of 2 running");
    expect(html).toContain("invalid route file: nope");
    expect(html).not.toContain("services are running");
    expect(html).toMatch(/>Back</);
    expect(html).toMatch(/>Connect</);
  });

  it("warns when the selected environment has nothing running", () => {
    const html = render(found("staging"));
    expect(html).toContain("No Staging services are running.");
    expect(html.replace(/<[^>]+>/g, "")).toContain(
      "Start them with make staging, or connect now and start them later.",
    );
  });

  it("omits the start sentence without a hint", () => {
    const data = { ...discovery, files: [{ ...discovery.files[1], hint: null }] };
    const html = render(found("staging", data));
    expect(html).toContain("No Staging services are running.");
    expect(html).not.toContain("Start them with");
  });

  it("disables Connect without a usable environment", () => {
    const html = render(found(null));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Connect</);
  });

  it("offers another address when nothing answered", () => {
    const html = render({ kind: "address", found: false, address: "http://localhost:8090", invalid: false });
    expect(current(html)).toBe("1 Detect");
    expect(html).toContain("No local services found");
    expect(html).toMatch(/<label for="([^"]+)"[^>]*>Address<\/label>[\s\S]*<input id="\1"/);
    expect(html).toContain('value="http://localhost:8090"');
    expect(html).toContain(">Try again<");
    expect(html).toContain("Already have a route file?");
    expect(html).toContain(">Choose file…<");
    expect(html).not.toContain("Use a local address");
  });

  it("validates the address inline", () => {
    const html = render(
      { kind: "address", found: false, address: "http://localhost:8090", invalid: true },
      "http://example.com",
    );
    expect(html).toContain("Use a local address, like http://localhost:8090");
    expect(html).toContain('aria-invalid="true"');
  });

  it("does not claim nothing was found after going back from results", () => {
    const html = render({ kind: "address", found: true, address: "http://localhost:8090", invalid: false });
    expect(html).not.toContain("No local services found");
    expect(html).toContain("Look at another address");
  });

  it.each([
    ["file", "That file can't be used", "Choose another file", "2 Choose"],
    ["response", "That service sent an invalid response", "Try again", "1 Detect"],
    ["config", "config.toml couldn't be updated", "Try again", "3 Connect"],
  ] as const)("explains an invalid %s", (problem, title, action, active) => {
    const html = render({
      kind: "invalid",
      problem,
      message: "exact error text",
      target: "/s/bad.json",
      retry: problem === "file" ? { action: "choose" } : { action: "detect" },
      back: { kind: "closed" },
    });
    expect(current(html)).toBe(active);
    expect(html).toContain(title);
    expect(html).toContain("exact error text");
    expect(html).toContain("/s/bad.json");
    expect(html).toMatch(/>Back</);
    expect(html).toContain(`>${action}<`);
  });
});
