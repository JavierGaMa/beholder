export interface ApksTestResult {
  ok: boolean;
  count?: number;
  error?: string;
}

export type ApksTestState =
  | { phase: "idle" }
  | { phase: "testing"; url: string }
  | { phase: "ok"; url: string; count: number }
  | { phase: "failed"; url: string; error: string };

export function startApksTest(url: string): ApksTestState {
  return { phase: "testing", url: url.trim() };
}

export function applyApksTestResult(
  state: ApksTestState,
  url: string,
  result: ApksTestResult,
): ApksTestState {
  if (state.phase !== "testing" || state.url !== url.trim()) return state;
  if (result.ok && typeof result.count === "number") {
    return { phase: "ok", url: state.url, count: result.count };
  }
  return { phase: "failed", url: state.url, error: result.error ?? "Connection test failed" };
}

export function canSaveApks(state: ApksTestState, url: string): boolean {
  return state.phase === "ok" && state.url === url.trim();
}
