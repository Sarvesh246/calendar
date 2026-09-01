import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareTabTransition, resetTabTransition, snapTabIndex, tabTransition } from "./tab-swipe";

describe("snapTabIndex", () => {
  it("stays put when the tab width is unknown", () => {
    expect(snapTabIndex(1, 80, 0, 3)).toBe(1);
  });

  it("moves to the next tab past the halfway point", () => {
    expect(snapTabIndex(0, 60, 100, 3)).toBe(1);
    expect(snapTabIndex(0, 49, 100, 3)).toBe(0);
  });

  it("clamps to the ends of the bar", () => {
    expect(snapTabIndex(0, -80, 100, 3)).toBe(0);
    expect(snapTabIndex(2, 80, 100, 3)).toBe(2);
  });
});

describe("prepareTabTransition", () => {
  afterEach(() => {
    resetTabTransition();
    vi.unstubAllGlobals();
  });

  it("continues a mid-swipe instead of restarting from zero", () => {
    vi.stubGlobal("innerWidth", 400);
    prepareTabTransition(0, 1, -160);
    expect(tabTransition.fromSwipe).toBe(true);
    expect(tabTransition.enterX).toBe(240);
    expect(tabTransition.exitX).toBe(-400);
  });

  it("uses a short peek when the change was a tap", () => {
    vi.stubGlobal("innerWidth", 400);
    prepareTabTransition(2, 1, 0);
    expect(tabTransition.fromSwipe).toBe(false);
    expect(tabTransition.enterX).toBe(-64);
    expect(tabTransition.exitX).toBe(64);
  });
});
