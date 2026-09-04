import { describe, expect, it } from "vitest";
import {
  applyApksTestResult,
  canSaveApks,
  startApksTest,
  type ApksTestState,
} from "./apksOnboardingState";

const URL = "https://acct.blob.core.windows.net/cont?restype=container&comp=list";

function testing(url = URL): ApksTestState {
  return startApksTest(url);
}

describe("apks onboarding wizard state", () => {
  it("starts a test against the trimmed url", () => {
    expect(startApksTest(`  ${URL}  `)).toEqual({ phase: "testing", url: URL });
  });

  it("applies a successful result with the found count", () => {
    const state = applyApksTestResult(testing(), URL, { ok: true, count: 7 });
    expect(state).toEqual({ phase: "ok", url: URL, count: 7 });
  });

  it("applies a failed result with the raw error", () => {
    const state = applyApksTestResult(testing(), URL, { ok: false, error: "404 Not Found" });
    expect(state).toEqual({ phase: "failed", url: URL, error: "404 Not Found" });
  });

  it("falls back to a generic error when the result has none", () => {
    const state = applyApksTestResult(testing(), URL, { ok: false });
    expect(state).toEqual({ phase: "failed", url: URL, error: "Connection test failed" });
  });

  it("ignores stale results after the url changed mid-flight", () => {
    const pending = testing();
    expect(applyApksTestResult(pending, "https://other.example.com", { ok: true, count: 1 })).toBe(
      pending,
    );
  });

  it("ignores results applied outside a running test", () => {
    const idle: ApksTestState = { phase: "idle" };
    expect(applyApksTestResult(idle, URL, { ok: true, count: 1 })).toBe(idle);
  });

  it("enables save only after a successful test of the current url", () => {
    expect(canSaveApks({ phase: "idle" }, URL)).toBe(false);
    expect(canSaveApks(testing(), URL)).toBe(false);
    expect(
      canSaveApks({ phase: "failed", url: URL, error: "x" }, URL),
    ).toBe(false);
    expect(canSaveApks({ phase: "ok", url: URL, count: 3 }, URL)).toBe(true);
  });

  it("disables save when the url is edited after a successful test", () => {
    const state: ApksTestState = { phase: "ok", url: URL, count: 3 };
    expect(canSaveApks(state, `${URL}&prefix=APKs/`)).toBe(false);
    expect(canSaveApks(state, `  ${URL}  `)).toBe(true);
  });
});
