import { beforeEach, describe, expect, it } from "vitest";
import { useUIStore } from "./ui-store";

const surfaces = [
  "commandPaletteOpen",
  "filterOpen",
  "aiDrawerOpen",
  "classScheduleOpen",
  "shortcutsOpen",
] as const;

beforeEach(() => {
  useUIStore.setState({
    commandPaletteOpen: false,
    filterOpen: false,
    aiDrawerOpen: false,
    classScheduleOpen: false,
    classScheduleCategoryId: null,
    shortcutsOpen: false,
    quickAddOpen: false,
    quickAddDateKey: null,
    quickAddTime: null,
    quickAddDurationMin: null,
    contextMenu: null,
  });
});

describe("primary surfaces", () => {
  it("atomically hands the viewport from one surface to another", () => {
    const actions = useUIStore.getState();
    actions.setAIDrawerOpen(true);
    actions.setFilterOpen(true);
    actions.setCommandPaletteOpen(true);

    const state = useUIStore.getState();
    expect(state.commandPaletteOpen).toBe(true);
    expect(surfaces.filter((key) => state[key])).toEqual(["commandPaletteOpen"]);
  });

  it("closes other surfaces when Add opens", () => {
    useUIStore.getState().openClassSchedule("class-1");
    useUIStore.setState({
      quickAddDateKey: "2026-09-14",
      quickAddTime: { hour: 9, minute: 30 },
      quickAddDurationMin: 45,
    });

    useUIStore.getState().setQuickAddOpen(true);
    const state = useUIStore.getState();

    expect(state.quickAddOpen).toBe(true);
    expect(state.classScheduleOpen).toBe(false);
    expect(state.classScheduleCategoryId).toBeNull();
    expect(surfaces.some((key) => state[key])).toBe(false);
  });

  it("opens Schedule without leaving an invisible surface above it", () => {
    useUIStore.getState().setFilterOpen(true);
    useUIStore.getState().openClassSchedule("class-2");

    const state = useUIStore.getState();
    expect(state.classScheduleOpen).toBe(true);
    expect(state.classScheduleCategoryId).toBe("class-2");
    expect(surfaces.filter((key) => state[key])).toEqual(["classScheduleOpen"]);
  });
});
