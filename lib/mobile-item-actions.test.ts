import { beforeEach, describe, expect, it } from "vitest";
import { useDatebookStore } from "./store";
import { changeMobileStatus, mobileReschedule, relativeScheduleDate, rescheduledDate, useMobileUndo } from "./mobile-item-actions";

const store = () => useDatebookStore.getState();
const make = () => store().addItem({ title: "Imported essay", categoryId: "class", type: "assignment", sourceId: "feed", status: "todo", at: new Date(2026, 8, 12, 16, 30).toISOString() });
beforeEach(() => { useDatebookStore.setState({ items: [], deletions: {}, lastDeleted: null, mode: "local", userId: null }); useMobileUndo.getState().set(null); });
describe("mobile item actions", () => {
  it("changes all statuses and undoes completion without losing unrelated edits", () => {
    const item = make(); changeMobileStatus(item, "doing");
    expect(store().items[0].status).toBe("doing");
    changeMobileStatus(store().items[0], "done");
    expect(store().items[0].completedAt).toBeTruthy();
    store().updateItem(item.id, { description: "New notes" });
    useMobileUndo.getState().action!.undo();
    expect(store().items[0]).toMatchObject({ status: "doing", description: "New notes" });
    expect(store().items[0].completedAt).toBeUndefined();
  });
  it("plans imported work without modifying the real deadline or copying its feed identity", () => {
    const item = make(); mobileReschedule(item, "2026-09-14", true);
    expect(store().items[0]).toEqual(item);
    expect(store().items[1]).toMatchObject({ type: "task", status: "todo", title: "Work on: Imported essay" });
    expect(store().items[1].sourceId).toBeUndefined();
    useMobileUndo.getState().action!.undo();
    expect(store().items).toEqual([item]);
  });
  it("explicitly changes and restores the actual deadline", () => {
    const item = make(); mobileReschedule(item, "2026-09-20", false);
    expect(new Date(store().items[0].at).getDate()).toBe(20);
    expect(new Date(store().items[0].at).getHours()).toBe(16);
    useMobileUndo.getState().action!.undo();
    expect(store().items[0].at).toBe(item.at);
  });
  it("preserves an event duration when moving its date", () => {
    const item = { ...make(), endAt: new Date(2026, 8, 12, 18).toISOString() };
    store().updateItem(item.id, { endAt: item.endAt }); mobileReschedule(item, "2026-10-01", false);
    expect(new Date(store().items[0].endAt!).getTime() - new Date(store().items[0].at).getTime()).toBe(90 * 60000);
  });
  it("uses local calendar days across month/year boundaries", () => {
    expect(relativeScheduleDate(1, new Date(2026, 11, 31, 23))).toBe("2027-01-01");
    expect(relativeScheduleDate(7, new Date(2026, 11, 28))).toBe("2027-01-04");
    const next = new Date(rescheduledDate(new Date(2026, 2, 7, 16, 30).toISOString(), "2026-03-08"));
    expect([next.getDate(), next.getHours(), next.getMinutes()]).toEqual([8, 16, 30]);
  });
});
