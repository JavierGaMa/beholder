import { describe, expect, it } from "vitest";
import { followTarget, shouldUnfollow, UNFOLLOW_DISTANCE_PX } from "./follow";

describe("shouldUnfollow", () => {
  it("never unfollows on a programmatic scroll", () => {
    expect(shouldUnfollow({ distanceFromBottom: 500, follow: true, programmatic: true })).toBe(false);
    expect(shouldUnfollow({ distanceFromBottom: UNFOLLOW_DISTANCE_PX, follow: true, programmatic: true })).toBe(false);
  });

  it("unfollows on a user scroll at or beyond the threshold", () => {
    expect(shouldUnfollow({ distanceFromBottom: UNFOLLOW_DISTANCE_PX, follow: true, programmatic: false })).toBe(true);
    expect(shouldUnfollow({ distanceFromBottom: 500, follow: true, programmatic: false })).toBe(true);
  });

  it("keeps follow when a user scroll stays near the bottom", () => {
    expect(shouldUnfollow({ distanceFromBottom: UNFOLLOW_DISTANCE_PX - 1, follow: true, programmatic: false })).toBe(false);
    expect(shouldUnfollow({ distanceFromBottom: 0, follow: true, programmatic: false })).toBe(false);
  });

  it("keeps follow unchanged when not following", () => {
    expect(shouldUnfollow({ distanceFromBottom: 500, follow: false, programmatic: false })).toBe(false);
  });
});

describe("followTarget", () => {
  it("returns null for empty rows instead of -1", () => {
    expect(followTarget([])).toBe(null);
  });

  it("returns the last row index otherwise", () => {
    expect(followTarget([{}, {}, {}])).toBe(2);
    expect(followTarget([{}])).toBe(0);
  });
});
