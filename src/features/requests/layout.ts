import { type PaneBounds } from "../../lib/pane";

export const DEFAULT_DETAIL_WIDTH = 440;
export const DETAIL_WIDTH_BOUNDS: PaneBounds = {
  min: 320,
  max: 720,
  fallback: DEFAULT_DETAIL_WIDTH,
};
export const LIST_MIN_WIDTH = 360;
export const DETAIL_RESIZE_HANDLE_WIDTH = 8;

export function maxDetailWidth(containerWidth: number, listMin = LIST_MIN_WIDTH): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return DETAIL_WIDTH_BOUNDS.max;
  const available = containerWidth - listMin - DETAIL_RESIZE_HANDLE_WIDTH;
  return Math.max(DETAIL_WIDTH_BOUNDS.min, Math.min(DETAIL_WIDTH_BOUNDS.max, available));
}

export interface RequestDetailLayout {
  collapsed: boolean;
  listCollapsed: boolean;
  width: number;
}

export const DEFAULT_REQUEST_DETAIL_LAYOUT: RequestDetailLayout = {
  collapsed: false,
  listCollapsed: false,
  width: DEFAULT_DETAIL_WIDTH,
};

export function parseRequestDetailLayout(raw: string | null): Partial<RequestDetailLayout> | null {
  if (raw == null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const source = parsed as Record<string, unknown>;
  const result: Partial<RequestDetailLayout> = {};
  if (typeof source.collapsed === "boolean") result.collapsed = source.collapsed;
  if (typeof source.listCollapsed === "boolean") result.listCollapsed = source.listCollapsed;
  if (typeof source.width === "number" && Number.isFinite(source.width)) result.width = source.width;
  return result;
}

export function serializeRequestDetailLayout(layout: RequestDetailLayout): string {
  return JSON.stringify(layout);
}
