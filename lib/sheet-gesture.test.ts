import { describe, expect, it } from "vitest";
import { shouldDismissSheet, shouldExpandSheet, SHEET_DISMISS, SHEET_EXPAND } from "./sheet-gesture";
import type { PanInfo } from "framer-motion";

function pan(y: number, vy: number): PanInfo {
  return {
    offset: { x: 0, y },
    velocity: { x: 0, y: vy },
    delta: { x: 0, y },
    point: { x: 0, y },
  } as PanInfo;
}

describe("shouldDismissSheet", () => {
  it("commits on a short pull that still cleared the offset", () => {
    expect(shouldDismissSheet(pan(SHEET_DISMISS.offset + 1, 0))).toBe(true);
  });

  it("lets a short drag snap back", () => {
    expect(shouldDismissSheet(pan(24, 80))).toBe(false);
  });

  it("commits on a flick even before the offset", () => {
    expect(shouldDismissSheet(pan(20, SHEET_DISMISS.velocity + 10))).toBe(true);
  });

  it("scales the offset for a taller detent", () => {
    expect(shouldDismissSheet(pan(SHEET_DISMISS.offset + 1, 0), 1.4)).toBe(false);
    expect(shouldDismissSheet(pan(SHEET_DISMISS.offset * 1.4 + 1, 0), 1.4)).toBe(true);
  });
});

describe("shouldExpandSheet", () => {
  it("opens the full detent on an upward throw", () => {
    expect(shouldExpandSheet(pan(SHEET_EXPAND.offset - 1, 0))).toBe(true);
    expect(shouldExpandSheet(pan(-8, SHEET_EXPAND.velocity - 1))).toBe(true);
    expect(shouldExpandSheet(pan(-8, 0))).toBe(false);
  });
});
