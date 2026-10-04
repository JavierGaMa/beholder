import { describe, expect, it, vi } from "vitest";

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

const { isTrafficView } = await import("./CommandBar");
import type { View } from "../../store/traffic";

const ALL_VIEWS: View[] = [
  "requests",
  "websockets",
  "emulators",
  "apks",
  "database",
  "console",
];

describe("isTrafficView", () => {
  it("is true only for traffic views", () => {
    expect(ALL_VIEWS.filter(isTrafficView)).toEqual(["requests", "websockets"]);
  });

  it("is false for every device view", () => {
    for (const view of ["emulators", "apks", "database", "console"] as View[]) {
      expect(isTrafficView(view)).toBe(false);
    }
  });
});
