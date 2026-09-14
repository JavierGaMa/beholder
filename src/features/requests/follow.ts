export const UNFOLLOW_DISTANCE_PX = 48;
export const PROGRAMMATIC_SCROLL_RESET_MS = 200;

export function shouldUnfollow(input: { distanceFromBottom: number; follow: boolean; programmatic: boolean }): boolean {
  if (input.programmatic) return false;
  if (!input.follow) return false;
  return input.distanceFromBottom >= UNFOLLOW_DISTANCE_PX;
}

export function followTarget<T>(rows: T[]): number | null {
  return rows.length === 0 ? null : rows.length - 1;
}
