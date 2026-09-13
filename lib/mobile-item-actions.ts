"use client";

import { create } from "zustand";
import { addDays, format } from "date-fns";
import { useDatebookStore } from "@/lib/store";
import type { Item, ItemStatus } from "@/lib/types";

type UndoAction = { label: string; undo: () => void; stamp: number };
export const useMobileUndo = create<{ action: UndoAction | null; set: (action: UndoAction | null) => void }>(set => ({ action: null, set: action => set({ action }) }));
function offerUndo(label: string, undo: () => void) {
  useMobileUndo.getState().set({ label, undo, stamp: Date.now() });
}
export function changeMobileStatus(item: Item, status: ItemStatus) {
  const store = useDatebookStore.getState();
  if ((item.status ?? "todo") === status) return;
  store.updateItem(item.id, { status });
  offerUndo(status === "done" ? "Completed" : status === "doing" ? "Started" : "Moved to to do", () => {
    useDatebookStore.getState().updateItem(item.id, { status: item.status ?? "todo", completedAt: item.completedAt });
  });
}
/** Local calendar arithmetic retains the time of day across DST transitions. */
export function rescheduledDate(at: string, date: string) {
  const original = new Date(at);
  const next = new Date(`${date}T00:00:00`);
  next.setHours(original.getHours(), original.getMinutes(), original.getSeconds(), original.getMilliseconds());
  return next.toISOString();
}
export function mobileReschedule(item: Item, date: string, planWork: boolean) {
  const store = useDatebookStore.getState();
  const at = rescheduledDate(item.at, date);
  if (planWork) {
    const planned = store.addItem({ title: `Work on: ${item.title}`, categoryId: item.categoryId, type: "task", status: "todo", at, allDay: true,
      description: `Work session for ${item.title}. Original deadline: ${format(new Date(item.at), "PPP p")}.`, url: item.url });
    offerUndo("Work planned · deadline unchanged", () => { const previousDelete = useDatebookStore.getState().lastDeleted; useDatebookStore.getState().deleteItem(planned.id); useDatebookStore.setState({ lastDeleted: previousDelete }); });
    return;
  }
  const endAt = item.endAt ? new Date(new Date(item.endAt).getTime() + new Date(at).getTime() - new Date(item.at).getTime()).toISOString() : undefined;
  store.updateItem(item.id, { at, ...(endAt ? { endAt } : {}) });
  offerUndo("Rescheduled", () => useDatebookStore.getState().updateItem(item.id, { at: item.at, endAt: item.endAt }));
}
export function relativeScheduleDate(days: number, now = new Date()) { return format(addDays(now, days), "yyyy-MM-dd"); }
