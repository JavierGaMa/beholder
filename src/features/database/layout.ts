import type { PaneBounds } from "../../lib/pane";

export { clampPaneWidth, resolvePaneWidth, RAIL_WIDTH, type PaneBounds } from "../../lib/pane";

export const DEFAULT_DBS_WIDTH = 288;
export const DBS_WIDTH_BOUNDS: PaneBounds = { min: 180, max: 420, fallback: DEFAULT_DBS_WIDTH };
export const DOCK_MIN_HEIGHT = 120;
export const DOCK_MAX_RATIO = 0.7;
export const DOCK_DEFAULT_RATIO = 0.4;

export interface DbLayout {
  dbsCollapsed: boolean;
  dbsWidth: number;
  sqlDockHeight: number | null;
}

export const DEFAULT_DB_LAYOUT: DbLayout = {
  dbsCollapsed: false,
  dbsWidth: DEFAULT_DBS_WIDTH,
  sqlDockHeight: null,
};

export function clampDockHeight(height: number, containerHeight: number): number {
  if (!Number.isFinite(height)) return defaultDockHeight(containerHeight);
  const max = Math.max(DOCK_MIN_HEIGHT, Math.floor(containerHeight * DOCK_MAX_RATIO));
  return Math.min(Math.max(height, DOCK_MIN_HEIGHT), max);
}

export function defaultDockHeight(containerHeight: number): number {
  return Math.floor(containerHeight * DOCK_DEFAULT_RATIO);
}

export function parseDbLayout(raw: string | null): Partial<DbLayout> | null {
  if (raw == null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const source = parsed as Record<string, unknown>;
  const result: Partial<DbLayout> = {};
  if (typeof source.dbsCollapsed === "boolean") result.dbsCollapsed = source.dbsCollapsed;
  if (typeof source.dbsWidth === "number" && Number.isFinite(source.dbsWidth)) result.dbsWidth = source.dbsWidth;
  if (source.sqlDockHeight === null) {
    result.sqlDockHeight = null;
  } else if (typeof source.sqlDockHeight === "number" && Number.isFinite(source.sqlDockHeight)) {
    result.sqlDockHeight = source.sqlDockHeight;
  }
  return result;
}

export function serializeDbLayout(layout: DbLayout): string {
  return JSON.stringify(layout);
}
