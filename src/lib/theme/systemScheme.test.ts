import { describe, expect, it, vi } from "vitest";
import { createSystemSchemeWatch } from "./systemScheme";

function fakeMatchMedia(startDark: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches: startDark,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener);
    },
  };
  const matchMedia = vi.fn(() => media);
  return { matchMedia, media, listeners, flip: () => {
    media.matches = !media.matches;
  } };
}

describe("createSystemSchemeWatch", () => {
  it("does not subscribe for concrete theme modes", () => {
    const { matchMedia, listeners } = fakeMatchMedia(false);
    const watch = createSystemSchemeWatch(matchMedia);
    watch.update("paper", () => {});
    watch.update("obsidian", () => {});
    expect(matchMedia).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  it("subscribes once for system mode and re-applies on scheme change", () => {
    const { matchMedia, listeners, media } = fakeMatchMedia(false);
    const watch = createSystemSchemeWatch(matchMedia);
    const reapply = vi.fn();
    watch.update("system", reapply);
    watch.update("system", reapply);
    expect(matchMedia).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(1);
    media.matches = true;
    for (const listener of listeners) listener();
    expect(reapply).toHaveBeenCalledTimes(1);
  });

  it("swaps the re-apply callback on later updates without duplicating listeners", () => {
    const { matchMedia, listeners } = fakeMatchMedia(true);
    const watch = createSystemSchemeWatch(matchMedia);
    const first = vi.fn();
    const second = vi.fn();
    watch.update("system", first);
    watch.update("system", second);
    for (const listener of listeners) listener();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(1);
  });

  it("unsubscribes when a later update leaves system mode", () => {
    const { matchMedia, listeners, flip } = fakeMatchMedia(false);
    const watch = createSystemSchemeWatch(matchMedia);
    const reapply = vi.fn();
    watch.update("system", reapply);
    watch.update("carbon", reapply);
    expect(listeners.size).toBe(0);
    flip();
    expect(reapply).not.toHaveBeenCalled();
    watch.update("system", reapply);
    expect(listeners.size).toBe(1);
  });

  it("stops listening on dispose", () => {
    const { matchMedia, listeners, flip } = fakeMatchMedia(false);
    const watch = createSystemSchemeWatch(matchMedia);
    const reapply = vi.fn();
    watch.update("system", reapply);
    watch.dispose();
    expect(listeners.size).toBe(0);
    flip();
    expect(reapply).not.toHaveBeenCalled();
  });
});
