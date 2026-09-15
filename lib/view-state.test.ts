import { describe, expect, it } from "vitest";
import { parseViewState } from "./view-state";

describe("parseViewState", () => {
  it("returns an empty state for nothing", () => {
    expect(parseViewState(null)).toEqual({ scroll: {} });
  });

  it("survives a value that isn't JSON", () => {
    expect(parseViewState("{not json")).toEqual({ scroll: {} });
  });

  it("survives JSON that isn't an object", () => {
    expect(parseViewState("42")).toEqual({ scroll: {} });
    expect(parseViewState("null")).toEqual({ scroll: {} });
  });

  it("keeps well-formed scroll offsets and drops the rest", () => {
    const s = parseViewState(
      JSON.stringify({ scroll: { "/agenda": 120, "/today": -4, "/calendar": "x" } })
    );
    expect(s.scroll).toEqual({ "/agenda": 120 });
  });

  it("round-trips calendar placement", () => {
    const s = parseViewState(
      JSON.stringify({
        scroll: {},
        calendarAnchor: "2026-03-01",
        calendarSelected: "2026-03-14",
        scheduleDay: 3,
      })
    );
    expect(s.calendarAnchor).toBe("2026-03-01");
    expect(s.calendarSelected).toBe("2026-03-14");
    expect(s.scheduleDay).toBe(3);
  });

  it("rejects a date that isn't a day key", () => {
    const s = parseViewState(JSON.stringify({ scroll: {}, calendarAnchor: "March 2026" }));
    expect(s.calendarAnchor).toBeUndefined();
  });

  it("rejects an out-of-range weekday", () => {
    expect(parseViewState(JSON.stringify({ scroll: {}, scheduleDay: 9 })).scheduleDay).toBeUndefined();
    expect(parseViewState(JSON.stringify({ scroll: {}, scheduleDay: 1.5 })).scheduleDay).toBeUndefined();
  });

  it("normalises an empty class filter to null", () => {
    expect(parseViewState(JSON.stringify({ scroll: {}, categoryFilter: [] })).categoryFilter)
      .toBe(null);
    expect(parseViewState(JSON.stringify({ scroll: {}, categoryFilter: ["a", 2] })).categoryFilter)
      .toEqual(["a"]);
  });

  it("keeps a valid last tab and drops anything else", () => {
    expect(parseViewState(JSON.stringify({ scroll: {}, lastTab: "/agenda" })).lastTab).toBe(
      "/agenda"
    );
    expect(parseViewState(JSON.stringify({ scroll: {}, lastTab: "/settings" })).lastTab).toBeUndefined();
    expect(parseViewState(JSON.stringify({ scroll: {}, lastTab: 3 })).lastTab).toBeUndefined();
  });
});
