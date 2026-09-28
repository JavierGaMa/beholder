export const DEFAULT_DBS_WIDTH = 288;
export const DEFAULT_TABLES_WIDTH = 224;
export const DBS_WIDTH_BOUNDS: PaneBounds = { min: 180, max: 420, fallback: DEFAULT_DBS_WIDTH };
export const TABLES_WIDTH_BOUNDS: PaneBounds = { min: 140, max: 320, fallback: DEFAULT_TABLES_WIDTH };
export const DOCK_MIN_HEIGHT = 120;
export const DOCK_MAX_RATIO = 0.7;
export const DOCK_DEFAULT_RATIO = 0.4;
export const RAIL_WIDTH = 44;

export interface PaneBounds {
  min: number;
  max: number;
  fallback: number;
}

export interface DbLayout {
  dbsCollapsed: boolean;
  dbsWidth: number;
  tablesCollapsed: boolean;
  tablesWidth: number;
  sqlDockHeight: number | null;
}

export const DEFAULT_DB_LAYOUT: DbLayout = {
  dbsCollapsed: false,
  dbsWidth: DEFAULT_DBS_WIDTH,
  tablesCollapsed: false,
  tablesWidth: DEFAULT_TABLES_WIDTH,
  sqlDockHeight: null,
};

export function clampPaneWidth(width: number, bounds: PaneBounds): number {
  if (!Number.isFinite(width)) return bounds.fallback;
  return Math.min(Math.max(width, bounds.min), bounds.max);
}

export function resolvePaneWidth(input: { collapsed: boolean; width: number; bounds: PaneBounds }): number {
  return input.collapsed ? RAIL_WIDTH : clampPaneWidth(input.width, input.bounds);
}

export function clampDockHeight(height: number, containerHeight: number): number {
  if (!Number.isFinite(height)) return defaultDockHeight(containerHeight);
  const max = Math.max(DOCK_MIN_HEIGHT, Math.floor(containerHeight * DOCK_MAX_RATIO));
  return Math.min(Math.max(height, DOCK_MIN_HEIGHT), max);
}

export function defaultDockHeight(containerHeight: number): number {
  return Math.floor(containerHeight * DOCK_DEFAULT_RATIO);
}

export function isRunShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.key === "Enter" && (e.metaKey || e.ctrlKey);
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
  if (typeof source.tablesCollapsed === "boolean") result.tablesCollapsed = source.tablesCollapsed;
  if (typeof source.dbsWidth === "number" && Number.isFinite(source.dbsWidth)) result.dbsWidth = source.dbsWidth;
  if (typeof source.tablesWidth === "number" && Number.isFinite(source.tablesWidth)) {
    result.tablesWidth = source.tablesWidth;
  }
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
