"use client";

import { create } from "zustand";
import { useDatebookStore } from "./store";

/**
 * One reversible change at a time — a move, a status flip, a batch edit, a
 * duplicate. Deletes keep their own toast (`lastDeleted`); this covers every
 * other edit that should come with an Undo.
 */
export type UndoAction = { label: string; undo: () => void; stamp: number };

export const useActionUndo = create<{
  action: UndoAction | null;
  set: (action: UndoAction | null) => void;
}>((set) => ({ action: null, set: (action) => set({ action }) }));

export function offerUndo(label: string, undo: () => void) {
  useActionUndo.getState().set({ label, undo, stamp: Date.now() });
}

/** When the delete toast last armed, so Ctrl+Z reverses whichever came last. */
let deletedStamp = 0;
if (typeof window !== "undefined") {
  useDatebookStore.subscribe((state, prev) => {
    if (state.lastDeleted && state.lastDeleted !== prev.lastDeleted) deletedStamp = Date.now();
  });
}

/** Reverse the most recent change that still has an Undo on screen. */
export function undoLatest(): boolean {
  const { action, set } = useActionUndo.getState();
  const store = useDatebookStore.getState();
  if (action && (!store.lastDeleted || action.stamp >= deletedStamp)) {
    set(null);
    action.undo();
    return true;
  }
  if (store.lastDeleted) {
    store.restoreLastDeleted();
    return true;
  }
  return false;
}
