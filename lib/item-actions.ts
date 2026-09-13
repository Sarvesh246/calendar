"use client";

import { format } from "date-fns";
import { useDatebookStore } from "./store";
import { offerUndo } from "./action-undo";
import { dateFromDayKey, dayDelta, shiftedByDays } from "./calendar-drag-math";
import { dayKey } from "./date-utils";
import { nanoid } from "./nanoid";
import { formatDuration } from "./work-sessions";
import type { Item, ItemStatus } from "./types";

type Patch = Partial<Item>;

/** The values a patch is about to overwrite, so Undo can write them back. */
function restorePatch(prev: Item, patch: Patch): Patch {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) out[key] = prev[key as keyof Item];
  if ("status" in patch) out.completedAt = prev.completedAt;
  return out as Patch;
}

function current(id: string): Item | undefined {
  return useDatebookStore.getState().items.find((i) => i.id === id);
}

/** Apply one edit and put an Undo for it on screen. */
export function applyItemPatch(item: Item, patch: Patch, label: string) {
  const prev = current(item.id);
  if (!prev) return;
  const undo = restorePatch(prev, patch);
  useDatebookStore.getState().updateItem(prev.id, patch);
  offerUndo(label, () => {
    if (current(prev.id)) useDatebookStore.getState().updateItem(prev.id, undo);
  });
}

/** Apply an edit to many items behind a single Undo. Returns how many changed. */
export function applyBatchPatch(
  items: Item[],
  makePatch: (item: Item) => Patch | null,
  label: (count: number) => string
): number {
  const store = useDatebookStore.getState();
  const byId = new Map(store.items.map((i) => [i.id, i]));
  const undos: [string, Patch][] = [];
  for (const it of items) {
    const prev = byId.get(it.id);
    if (!prev) continue;
    const patch = makePatch(prev);
    if (!patch || Object.keys(patch).length === 0) continue;
    undos.push([prev.id, restorePatch(prev, patch)]);
    store.updateItem(prev.id, patch);
  }
  if (undos.length) {
    offerUndo(label(undos.length), () => {
      const s = useDatebookStore.getState();
      for (const [id, patch] of undos) if (s.items.some((i) => i.id === id)) s.updateItem(id, patch);
    });
  }
  return undos.length;
}

export function dayLabelFor(key: string) {
  return format(dateFromDayKey(key), "EEE, MMM d");
}

/** Move an item to another day, keeping its time of day (and length). */
export function rescheduleToDay(item: Item, targetKey: string, fromKey = dayKey(new Date(item.at))) {
  const days = dayDelta(fromKey, targetKey);
  if (!days) return;
  applyItemPatch(item, shiftedByDays(item, days), `Moved to ${dayLabelFor(targetKey)}`);
}

export const STATUS_LABEL: Record<ItemStatus, string> = {
  todo: "To do",
  doing: "In progress",
  done: "Done",
};

export function setStatusWithUndo(item: Item, status: ItemStatus) {
  if (item.type === "event" || (item.status ?? "todo") === status) return;
  applyItemPatch(
    item,
    { status },
    status === "done" ? "Marked done" : status === "doing" ? "Marked in progress" : "Moved back to to do"
  );
}

/** Take something off the calendar without leaving it in the delete toast. */
function removeQuietly(id: string) {
  const store = useDatebookStore.getState();
  const previous = store.lastDeleted;
  store.deleteItem(id);
  useDatebookStore.setState({ lastDeleted: previous });
}

/**
 * A fresh copy: same content and time, a new identity. Feed links, series
 * membership and completion don't come along — the copy is yours and open.
 */
export function duplicateItem(item: Item): Item {
  const copy: Record<string, unknown> = { ...item };
  for (const key of [
    "id",
    "createdAt",
    "updatedAt",
    "sourceId",
    "sourceUid",
    "sourceSnapshot",
    "repeat",
    "repeatId",
    "completedAt",
    "statusAt",
  ]) {
    delete copy[key];
  }
  const draft = copy as Omit<Item, "id" | "createdAt">;
  if (item.type !== "event") draft.status = "todo";
  if (item.reminders?.length) {
    draft.reminders = item.reminders.map((r) => ({ ...r, id: nanoid(), itemId: "" }));
  }
  const created = useDatebookStore.getState().addItem(draft);
  offerUndo("Duplicated", () => removeQuietly(created.id));
  return created;
}

/**
 * Block out time for an assignment or task. The session is a separate event
 * pointing back at the work, so "write essay Tuesday afternoon" never moves
 * "essay due Friday".
 */
export function planWorkSession(item: Item, start: Date, minutes: number): Item {
  const end = new Date(start.getTime() + minutes * 60_000);
  const session = useDatebookStore.getState().addItem({
    type: "event",
    title: `Work on: ${item.title}`,
    categoryId: item.categoryId,
    at: start.toISOString(),
    endAt: end.toISOString(),
    workFor: item.id,
    ...(item.url ? { url: item.url } : {}),
  });
  offerUndo(`Planned ${formatDuration(minutes)} · ${format(start, "EEE h:mm a")}`, () =>
    removeQuietly(session.id)
  );
  return session;
}

/** Delete with the standard delete toast (it already carries Undo). */
export function deleteWithToast(item: Item) {
  useDatebookStore.getState().deleteItem(item.id);
}
