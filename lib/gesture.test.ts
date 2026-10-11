import { describe, expect, it } from "vitest";
import { VelocityTracker, nearestSnap, project, rubberband, rubberbandClamp } from "./gesture";

describe("VelocityTracker", () => {
  it("averages over the recent window", () => {
    const t = new VelocityTracker();
    t.reset(0, 0);
    t.add(10, 16);
    t.add(20, 32);
    t.add(30, 48);
    expect(t.velocity(48)).toBeCloseTo(625, 0);
  });

  it("reads zero once the finger has held still", () => {
    const t = new VelocityTracker();
    t.reset(0, 0);
    t.add(40, 16);
    t.add(80, 32);
    // Pointer held for 300ms, then released with no further moves.
    expect(t.velocity(332)).toBe(0);
  });

  it("forgets samples older than the window", () => {
    const t = new VelocityTracker();
    t.reset(0, 0);
    t.add(500, 10); // a fast start…
    for (let i = 1; i <= 10; i++) t.add(500 + i, 10 + i * 16); // …then a crawl
    expect(Math.abs(t.velocity(170))).toBeLessThan(100);
  });
});

describe("rubberband", () => {
  it("tracks nearly 1:1 for a short pull and stiffens for a long one", () => {
    const short = rubberband(10, 400);
    const long = rubberband(400, 400);
    expect(short / 10).toBeGreaterThan(0.5);
    expect(long / 400).toBeLessThan(0.45);
  });

  it("never reaches the dimension", () => {
    expect(rubberband(100000, 300)).toBeLessThan(300);
    expect(rubberband(-100000, 300)).toBeGreaterThan(-300);
  });

  it("is 1:1 inside the clamp range", () => {
    expect(rubberbandClamp(50, 0, 100, 300)).toBe(50);
    expect(rubberbandClamp(150, 0, 100, 300)).toBeLessThan(150);
    expect(rubberbandClamp(150, 0, 100, 300)).toBeGreaterThan(100);
  });
});

describe("project", () => {
  it("coasts further the faster the release", () => {
    expect(project(0, 1000)).toBeGreaterThan(project(0, 400));
    expect(project(100, 0)).toBe(100);
  });
});

describe("nearestSnap", () => {
  it("picks the closest point", () => {
    expect(nearestSnap(140, [0, 300])).toBe(0);
    expect(nearestSnap(160, [0, 300])).toBe(300);
  });
});
