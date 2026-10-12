import { describe, expect, it } from "vitest";
import { SHEET_FLICK_CLOSE, sheetRelease } from "./sheet-gesture";

const one = { height: 500, points: [0] };
const two = { height: 700, points: [0, 380] };

describe("sheetRelease", () => {
  it("lets a short slow drag spring home", () => {
    expect(sheetRelease({ ...one, at: 24, velocity: 80 })).toEqual({ kind: "snap", index: 0 });
  });

  it("closes a long slow pull", () => {
    expect(sheetRelease({ ...one, at: 260, velocity: 0 })).toEqual({ kind: "close" });
  });

  it("closes a quick flick before it has travelled far", () => {
    expect(sheetRelease({ ...one, at: 30, velocity: SHEET_FLICK_CLOSE + 50 })).toEqual({
      kind: "close",
    });
  });

  it("stays when the pull is heading back up at release", () => {
    expect(sheetRelease({ ...one, at: 260, velocity: -600 })).toEqual({ kind: "snap", index: 0 });
  });

  it("lands a throw on the detent it was heading for", () => {
    expect(sheetRelease({ ...two, at: 300, velocity: -900 })).toEqual({ kind: "snap", index: 0 });
    expect(sheetRelease({ ...two, at: 120, velocity: 900 })).toEqual({ kind: "snap", index: 1 });
  });

  it("closes from the lower detent, not from the upper one", () => {
    expect(sheetRelease({ ...two, at: 120, velocity: 300 })).toEqual({ kind: "snap", index: 0 });
    expect(sheetRelease({ ...two, at: 520, velocity: 200 })).toEqual({ kind: "close" });
  });
});
