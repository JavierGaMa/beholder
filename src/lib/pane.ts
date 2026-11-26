export const RAIL_WIDTH = 44;

export interface PaneBounds {
  min: number;
  max: number;
  fallback: number;
}

export function clampPaneWidth(width: number, bounds: PaneBounds): number {
  if (!Number.isFinite(width)) return bounds.fallback;
  return Math.min(Math.max(width, bounds.min), bounds.max);
}

export function resolvePaneWidth(input: { collapsed: boolean; width: number; bounds: PaneBounds }): number {
  return input.collapsed ? RAIL_WIDTH : clampPaneWidth(input.width, input.bounds);
}
