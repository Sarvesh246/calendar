import { describe, expect, it } from "vitest";
import {
  commitPageFromGesture,
  commitTabFromGesture,
  neighbourTab,
  pageSwipeIgnores,
  pillSpringForVelocity,
  rubberbandPageX,
} from "./tab-swipe";
import { TAB_ROUTES } from "./tab-routes";

describe("commitPageFromGesture", () => {
  const width = 390;

  it("snaps back when released before halfway without a flick", () => {
    expect(
      commitPageFromGesture({ startIndex: 1, dx: -width * 0.3, vx: -80, width, count: 3 })
    ).toBe(1);
    expect(
      commitPageFromGesture({ startIndex: 1, dx: width * 0.3, vx: 80, width, count: 3 })
    ).toBe(1);
  });

  it("commits after the halfway point", () => {
    expect(
      commitPageFromGesture({ startIndex: 1, dx: -width * 0.5, vx: -40, width, count: 3 })
    ).toBe(2);
    expect(
      commitPageFromGesture({ startIndex: 1, dx: width * 0.5, vx: 40, width, count: 3 })
    ).toBe(0);
  });

  it("lets a flick take the neighbour before halfway", () => {
    expect(
      commitPageFromGesture({ startIndex: 0, dx: -40, vx: -900, width, count: 3 })
    ).toBe(1);
    expect(
      commitPageFromGesture({ startIndex: 2, dx: 40, vx: 900, width, count: 3 })
    ).toBe(1);
  });

  it("rubber-bands instead of wrapping past the ends", () => {
    expect(
      commitPageFromGesture({ startIndex: 0, dx: 200, vx: 1200, width, count: 3 })
    ).toBe(0);
    expect(
      commitPageFromGesture({ startIndex: 2, dx: -200, vx: -1200, width, count: 3 })
    ).toBe(2);
  });
});

describe("rubberbandPageX", () => {
  it("yields at the first and last tab and tracks in the middle", () => {
    expect(rubberbandPageX(100, 0, 3)).toBe(22);
    expect(rubberbandPageX(-100, 2, 3)).toBe(-22);
    expect(rubberbandPageX(-80, 1, 3)).toBe(-80);
  });
});

describe("neighbourTab", () => {
  it("peeks the tab the finger is pulling toward", () => {
    expect(neighbourTab(1, -12)).toBe(TAB_ROUTES[2]);
    expect(neighbourTab(1, 12)).toBe(TAB_ROUTES[0]);
    expect(neighbourTab(0, 12)).toBeNull();
  });
});

describe("commitTabFromGesture", () => {
  const tabWidth = 120;

  it("rounds a slow drag to the nearest tab", () => {
    expect(
      commitTabFromGesture({ startIndex: 0, offset: 50, velocity: 40, tabWidth, count: 3 })
    ).toBe(0);
    expect(
      commitTabFromGesture({ startIndex: 0, offset: 70, velocity: 40, tabWidth, count: 3 })
    ).toBe(1);
  });

  it("commits a flick that has travelled a tenth of a tab", () => {
    expect(
      commitTabFromGesture({ startIndex: 0, offset: 20, velocity: 1100, tabWidth, count: 3 })
    ).toBe(1);
  });
});

describe("pillSpringForVelocity", () => {
  it("under-damps a throw and stays tight on a slow drag", () => {
    expect(pillSpringForVelocity(2000).damping).toBeLessThan(pillSpringForVelocity(80).damping);
    expect(pillSpringForVelocity(80).stiffness).toBeGreaterThan(pillSpringForVelocity(2000).stiffness);
  });
});

describe("pageSwipeIgnores", () => {
  it("lets a blank event through", () => {
    expect(pageSwipeIgnores(null)).toBe(false);
  });
});
