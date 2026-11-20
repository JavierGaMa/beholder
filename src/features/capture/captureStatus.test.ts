import { describe, expect, it } from "vitest";
import { formatElapsed, healthSummary } from "./captureStatus";
import type { CaptureCheckT } from "../../queries/captureHealth";

const check = (id: string, status: CaptureCheckT["status"]): CaptureCheckT => ({
  id,
  title: id,
  status,
  detail: "",
  fix: null,
});

describe("formatElapsed", () => {
  it("formats milliseconds as zero-padded mm:ss", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(999)).toBe("00:00");
    expect(formatElapsed(134_000)).toBe("02:14");
    expect(formatElapsed(59 * 60_000 + 59_000)).toBe("59:59");
  });

  it("keeps counting minutes past an hour", () => {
    expect(formatElapsed(61 * 60_000 + 5_000)).toBe("61:05");
  });

  it("treats negative or invalid input as zero", () => {
    expect(formatElapsed(-5_000)).toBe("00:00");
    expect(formatElapsed(Number.NaN)).toBe("00:00");
  });
});

describe("healthSummary", () => {
  it("lists proxy and metro ports and reports all checks passing", () => {
    expect(
      healthSummary({
        checks: [check("a", "ok"), check("b", "ok")],
        unknown: false,
        capturePort: 8080,
        metro: { detected: true, port: 8081 },
      }),
    ).toEqual({ text: "Proxy :8080, Metro :8081, all checks pass", tone: "muted" });
  });

  it("omits metro when it is not detected", () => {
    expect(
      healthSummary({
        checks: [check("a", "ok")],
        unknown: false,
        capturePort: 8080,
        metro: { detected: false, port: 8081 },
      }).text,
    ).toBe("Proxy :8080, all checks pass");
  });

  it("counts failing checks with singular and plural wording", () => {
    expect(
      healthSummary({
        checks: [check("a", "fail"), check("b", "ok")],
        unknown: false,
        capturePort: 8080,
        metro: null,
      }),
    ).toEqual({ text: "Proxy :8080, 1 check failing", tone: "danger" });
    expect(
      healthSummary({
        checks: [check("a", "fail"), check("b", "fail"), check("c", "warn")],
        unknown: false,
        capturePort: null,
        metro: null,
      }),
    ).toEqual({ text: "2 checks failing", tone: "danger" });
  });

  it("reports warnings when nothing fails", () => {
    expect(
      healthSummary({
        checks: [check("a", "warn"), check("b", "warn"), check("c", "ok")],
        unknown: false,
        capturePort: 8080,
        metro: null,
      }),
    ).toEqual({ text: "Proxy :8080, 2 warnings", tone: "warn" });
  });

  it("says health is being checked while results are unknown or empty", () => {
    expect(
      healthSummary({ checks: [], unknown: true, capturePort: 8080, metro: null }),
    ).toEqual({ text: "Proxy :8080, checking health", tone: "muted" });
    expect(
      healthSummary({ checks: [], unknown: false, capturePort: null, metro: null }).text,
    ).toBe("Checking health");
  });
});
