import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveryResult, RouteFilesUpdate } from "../../store/types";

interface Pending {
  cmd: string;
  args: Record<string, unknown> | undefined;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

const backend = vi.hoisted(() => ({
  calls: [] as Pending[],
  picked: null as string | null,
}));
vi.mock("../../lib/tauri", () => ({
  isTauri: false,
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    new Promise((resolve, reject) => {
      backend.calls.push({ cmd, args, resolve, reject });
    }),
  pickRouteFile: () => Promise.resolve(backend.picked),
}));
const storage = vi.hoisted(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  return map;
});

const { useConnect } = await import("./connectStore");
const { useRoutes } = await import("./store");
const { useTraffic } = await import("../../store/traffic");

const discovery: DiscoveryResult = {
  name: "local stack",
  address: "http://localhost:8090",
  files: [
    { id: "broken", label: "Broken", path: "/s/broken.json", hint: null, routes: 0, up: 0, error: "invalid route file" },
    { id: "staging", label: "Staging", path: "/s/staging.json", hint: "make staging", routes: 2, up: 0, error: null },
    { id: "dev", label: "Dev", path: "/s/dev.json", hint: null, routes: 3, up: 2, error: null },
  ],
};

const flush = () => new Promise((r) => setTimeout(r, 0));
const step = () => useConnect.getState().step;
const last = (cmd: string) => {
  const call = [...backend.calls].reverse().find((c) => c.cmd === cmd);
  if (!call) throw new Error(`no ${cmd} call`);
  return call;
};
const update = (files: string[], name: string, reset: string[]): RouteFilesUpdate => ({ files, name, reset });

async function found() {
  useConnect.getState().open();
  last("discover_routes").resolve(discovery);
  await flush();
}

beforeEach(() => {
  backend.calls.length = 0;
  backend.picked = null;
  storage.clear();
  useConnect.setState(useConnect.getInitialState(), true);
  useRoutes.setState({ enabled: [] });
  useTraffic.setState({ uiConfig: null });
});

describe("detecting", () => {
  it("queries the default address when none was used before", () => {
    useConnect.getState().open();
    expect(step()).toEqual({ kind: "detecting", address: "http://localhost:8090" });
    expect(last("discover_routes").args).toEqual({ address: "http://localhost:8090" });
  });

  it("selects the first environment with something running", async () => {
    await found();
    expect(step()).toMatchObject({ kind: "found", selected: "dev", connecting: false });
  });

  it("falls back to the first usable environment", async () => {
    useConnect.getState().open();
    last("discover_routes").resolve({ ...discovery, files: discovery.files.slice(0, 2) });
    await flush();
    expect(step()).toMatchObject({ kind: "found", selected: "staging" });
  });

  it("selects nothing when no environment is usable", async () => {
    useConnect.getState().open();
    last("discover_routes").resolve({ ...discovery, files: discovery.files.slice(0, 1) });
    await flush();
    expect(step()).toMatchObject({ kind: "found", selected: null });
    useConnect.getState().connect();
    expect(backend.calls).toHaveLength(1);
  });

  it("never selects an environment that has an error", async () => {
    await found();
    useConnect.getState().select("broken");
    expect(step()).toMatchObject({ selected: "dev" });
    useConnect.getState().select("staging");
    expect(step()).toMatchObject({ selected: "staging" });
  });

  it.each(["close", "reopen"])("ignores a result that arrives after %s", async (how) => {
    useConnect.getState().open();
    const stale = last("discover_routes");
    useConnect.getState().close();
    if (how === "reopen") useConnect.getState().open();
    const before = step();
    stale.resolve(discovery);
    await flush();
    expect(step()).toEqual(before);
  });

  it("ignores a failure that arrives after cancel", async () => {
    useConnect.getState().open();
    useConnect.getState().close();
    last("discover_routes").reject({ kind: "unreachable", message: "refused" });
    await flush();
    expect(step()).toEqual({ kind: "closed" });
  });

  it("asks for another address when nothing answers and remembers it", async () => {
    useConnect.getState().open();
    last("discover_routes").reject({ kind: "unreachable", message: "refused" });
    await flush();
    expect(step()).toEqual({
      kind: "address",
      found: false,
      address: "http://localhost:8090",
      invalid: false,
    });
    useConnect.getState().setAddress("http://127.0.0.1:9000");
    useConnect.getState().detect();
    last("discover_routes").reject({ kind: "unreachable", message: "refused" });
    await flush();
    expect(storage.get("beholder.discoveryAddress")).toBe("http://127.0.0.1:9000");
    useConnect.getState().close();
    useConnect.getState().open();
    expect(useConnect.getState().address).toBe("http://127.0.0.1:9000");
    expect(last("discover_routes").args).toEqual({ address: "http://127.0.0.1:9000" });
  });

  it("flags an invalid address without remembering it and clears the flag on edit", async () => {
    useConnect.getState().open();
    last("discover_routes").reject({ kind: "unreachable", message: "refused" });
    await flush();
    useConnect.getState().setAddress("http://example.com");
    useConnect.getState().detect();
    last("discover_routes").reject({ kind: "invalidAddress", message: "nope" });
    await flush();
    expect(step()).toEqual({
      kind: "address",
      found: false,
      address: "http://localhost:8090",
      invalid: true,
    });
    expect(storage.get("beholder.discoveryAddress")).toBe("http://localhost:8090");
    useConnect.getState().setAddress("http://localhost:1");
    expect(step()).toMatchObject({ invalid: false });
  });

  it("shows an invalid response and retries it", async () => {
    useConnect.getState().open();
    last("discover_routes").reject({ kind: "invalidResponse", message: "discovery document lists no files" });
    await flush();
    expect(step()).toMatchObject({
      kind: "invalid",
      problem: "response",
      message: "discovery document lists no files",
      target: "http://localhost:8090",
    });
    useConnect.getState().retry();
    expect(step()).toMatchObject({ kind: "detecting" });
    expect(backend.calls).toHaveLength(2);
  });

  it("goes back to the address step from an invalid response and from the results", async () => {
    useConnect.getState().open();
    last("discover_routes").reject({ kind: "invalidResponse", message: "bad" });
    await flush();
    useConnect.getState().back();
    expect(step()).toMatchObject({ kind: "address", found: false });
    await found();
    useConnect.getState().back();
    expect(step()).toMatchObject({ kind: "address", found: true, address: "http://localhost:8090" });
  });
});

describe("connecting a discovered environment", () => {
  it("replaces the sibling files, turns their routes off and shows the banner", async () => {
    useRoutes.setState({ enabled: ["/mine.json::a", "/s/staging.json::b", "/s/dev.json::c"] });
    await found();
    useConnect.getState().connect();
    useConnect.getState().connect();
    expect(step()).toMatchObject({ connecting: true });
    expect(backend.calls.filter((c) => c.cmd === "connect_route_file")).toHaveLength(1);
    expect(last("connect_route_file").args).toEqual({
      path: "/s/dev.json",
      replaces: ["/s/broken.json", "/s/staging.json"],
    });
    last("connect_route_file").resolve(
      update(["/mine.json", "/s/dev.json"], "dev routes", ["/s/staging.json", "/s/dev.json"]),
    );
    await flush();
    expect(step()).toEqual({ kind: "closed" });
    expect(useConnect.getState().banner).toBe(
      "Connected to local stack Dev. Turn on the services you want to use locally.",
    );
    expect(useRoutes.getState().enabled).toEqual(["/mine.json::a"]);
    expect(useTraffic.getState().uiConfig?.routes?.files).toEqual(["/mine.json", "/s/dev.json"]);
    useConnect.getState().dismiss();
    expect(useConnect.getState().banner).toBeNull();
  });

  it("still records the saved files when closed while connecting", async () => {
    await found();
    useConnect.getState().connect();
    useConnect.getState().close();
    last("connect_route_file").resolve(update(["/s/dev.json"], "dev", ["/s/dev.json"]));
    await flush();
    expect(step()).toEqual({ kind: "closed" });
    expect(useConnect.getState().banner).toBeNull();
    expect(useTraffic.getState().uiConfig?.routes?.files).toEqual(["/s/dev.json"]);
  });

  it.each([
    ["invalidFile", "file"],
    ["config", "config"],
  ])("explains a %s failure, then retries or goes back", async (kind, problem) => {
    await found();
    useConnect.getState().connect();
    last("connect_route_file").reject({ kind, message: "exact error" });
    await flush();
    expect(step()).toMatchObject({ kind: "invalid", problem, message: "exact error", target: "/s/dev.json" });
    useConnect.getState().retry();
    expect(backend.calls.filter((c) => c.cmd === "connect_route_file")).toHaveLength(2);
    last("connect_route_file").reject({ kind, message: "exact error" });
    await flush();
    useConnect.getState().back();
    expect(step()).toMatchObject({ kind: "found", selected: "dev", connecting: false });
  });
});

describe("choosing a file", () => {
  it("does nothing when the picker is dismissed", async () => {
    useConnect.getState().chooseFile();
    await flush();
    expect(backend.calls).toEqual([]);
    expect(step()).toEqual({ kind: "closed" });
  });

  it("connects the chosen file without replacing others", async () => {
    backend.picked = "/s/own.json";
    useConnect.getState().chooseFile();
    await flush();
    expect(last("connect_route_file").args).toEqual({ path: "/s/own.json", replaces: [] });
    last("connect_route_file").resolve(update(["/s/own.json"], "my routes", ["/s/own.json"]));
    await flush();
    expect(step()).toEqual({ kind: "closed" });
    expect(useConnect.getState().banner).toBe(
      "Connected to my routes. Turn on the services you want to use locally.",
    );
  });

  it("shows why a file cannot be used and offers another one", async () => {
    backend.picked = "/s/bad.json";
    useConnect.getState().chooseFile();
    await flush();
    last("connect_route_file").reject({ kind: "invalidFile", message: "unsupported route file version 2 (supported: 1)" });
    await flush();
    expect(step()).toMatchObject({
      kind: "invalid",
      problem: "file",
      message: "unsupported route file version 2 (supported: 1)",
      target: "/s/bad.json",
    });
    backend.picked = "/s/other.json";
    useConnect.getState().retry();
    await flush();
    expect(last("connect_route_file").args).toEqual({ path: "/s/other.json", replaces: [] });
    last("connect_route_file").reject({ kind: "invalidFile", message: "again" });
    await flush();
    useConnect.getState().back();
    expect(step()).toEqual({ kind: "closed" });
  });
});

describe("removing a file", () => {
  it("drops the file and turns its routes off", async () => {
    useRoutes.setState({ enabled: ["/a.json::x", "/b.json::y"] });
    useConnect.setState({ banner: "old" });
    useConnect.getState().removeFile("/a.json");
    expect(last("remove_route_file").args).toEqual({ path: "/a.json" });
    last("remove_route_file").resolve(update(["/b.json"], "", ["/a.json"]));
    await flush();
    expect(useRoutes.getState().enabled).toEqual(["/b.json::y"]);
    expect(useTraffic.getState().uiConfig?.routes?.files).toEqual(["/b.json"]);
    expect(useConnect.getState().banner).toBeNull();
  });
});
