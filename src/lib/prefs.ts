import type { Filters } from "../features/requests/filters";

export const DEFAULT_FILTERS: Filters = {
  text: "",
  status: "all",
  method: "",
  failuresOnly: false,
  slowOnly: false,
  inBodies: false,
  includeDomains: [],
  excludeDomains: [],
};

export function loadFilters(): Filters {
  try {
    const raw = localStorage.getItem("beholder.filters");
    if (!raw) return { ...DEFAULT_FILTERS };
    return { ...DEFAULT_FILTERS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}

export function saveFilters(f: Filters) {
  localStorage.setItem("beholder.filters", JSON.stringify(f));
}

export function loadFollow(): boolean {
  return localStorage.getItem("beholder.follow") !== "false";
}

export function saveFollow(v: boolean) {
  localStorage.setItem("beholder.follow", String(v));
}

export function loadSlowMs(): number {
  const v = Number(localStorage.getItem("beholder.slowMs"));
  return Number.isFinite(v) && v >= 50 ? v : 500;
}

export function saveSlowMs(v: number) {
  localStorage.setItem("beholder.slowMs", String(v));
}
