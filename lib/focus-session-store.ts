"use client";

import { create } from "zustand";
import { navigateTab } from "./tab-nav";
import { useDatebookStore } from "./store";
import { useUIStore } from "./ui-store";
import { startExclusiveDoing } from "./item-actions";
import {
  COUNTDOWN_MS,
  closeActiveAndSelect,
  defaultFocusItem,
  emptySession,
  isRunning,
  loadFocusSession,
  markOvertimeNotified as markOvertime,
  saveFocusSession,
  setClockMode,
  startClock,
  pauseClock,
  switchActive,
  toggleClock,
  type CountdownPreset,
  type FocusClock,
  type FocusSession,
} from "./focus-session";
import type { Category, Item } from "./types";

interface FocusSessionState {
  session: FocusSession | null;
  hydrated: boolean;
  hydrate: () => void;
  ensureSession: (itemId?: string | null, items?: Item[], categories?: Category[]) => void;
  toggle: () => void;
  pause: () => void;
  resume: () => void;
  setDuration: (preset: "stopwatch" | CountdownPreset) => void;
  switchItem: (itemId: string) => void;
  selectNext: (nextItemId: string | null) => void;
  endSession: () => void;
  markOvertimeNotified: () => void;
}

function persist(session: FocusSession | null) {
  saveFocusSession(session);
  return session;
}

function apply(set: (partial: Partial<FocusSessionState>) => void, session: FocusSession | null) {
  persist(session);
  set({ session });
}

function currentItems() {
  const { items, categories } = useDatebookStore.getState();
  return { items, categories };
}

export const useFocusSessionStore = create<FocusSessionState>((set, get) => ({
  session: null,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    set({ session: loadFocusSession(), hydrated: true });
  },

  ensureSession: (itemId, items, categories) => {
    if (!get().hydrated) get().hydrate();
    const lists = items && categories ? { items, categories } : currentItems();
    const now = Date.now();
    const existing = get().session;
    const pick =
      (itemId && lists.items.find((i) => i.id === itemId)) ||
      (existing?.activeItemId && lists.items.find((i) => i.id === existing.activeItemId && i.status !== "done")) ||
      defaultFocusItem(lists.items, new Date(now), lists.categories);

    if (!existing) {
      const id = pick?.id ?? itemId ?? null;
      apply(set, emptySession(id, now));
      if (itemId) {
        const item = lists.items.find((i) => i.id === itemId);
        if (item && item.type !== "event") startExclusiveDoing(item);
      }
      return;
    }
    if (itemId && itemId !== existing.activeItemId) {
      const next = switchActive(existing, itemId, now);
      apply(set, next);
      const item = lists.items.find((i) => i.id === itemId);
      if (item && item.type !== "event") startExclusiveDoing(item);
      return;
    }
    if (!existing.activeItemId && pick) {
      apply(set, { ...existing, activeItemId: pick.id, segments: [...existing.segments, { itemId: pick.id, startedAt: now, accumulatedMs: 0, pausedAt: now }] });
    }
  },

  toggle: () => {
    const session = get().session;
    if (!session?.activeItemId) return;
    const wasRunning = isRunning(session);
    const next = toggleClock(session, Date.now());
    apply(set, next);
    if (!wasRunning) {
      const item = useDatebookStore.getState().items.find((i) => i.id === next.activeItemId);
      if (item && item.type !== "event") startExclusiveDoing(item);
    }
  },

  pause: () => {
    const session = get().session;
    if (!session) return;
    apply(set, pauseClock(session, Date.now()));
  },

  resume: () => {
    const session = get().session;
    if (!session?.activeItemId) return;
    const next = startClock(session, Date.now());
    apply(set, next);
    const item = useDatebookStore.getState().items.find((i) => i.id === next.activeItemId);
    if (item && item.type !== "event") startExclusiveDoing(item);
  },

  setDuration: (preset) => {
    const session = get().session;
    if (!session) return;
    const now = Date.now();
    if (preset === "stopwatch") apply(set, setClockMode(session, "stopwatch", null, now));
    else apply(set, setClockMode(session, "countdown", COUNTDOWN_MS[preset], now));
  },

  switchItem: (itemId) => {
    const session = get().session;
    if (!session) {
      get().ensureSession(itemId);
      return;
    }
    const now = Date.now();
    apply(set, switchActive(session, itemId, now));
    const item = useDatebookStore.getState().items.find((i) => i.id === itemId);
    if (item && item.type !== "event") startExclusiveDoing(item);
  },

  selectNext: (nextItemId) => {
    const session = get().session;
    if (!session) return;
    apply(set, closeActiveAndSelect(session, nextItemId, Date.now()));
  },

  endSession: () => apply(set, null),

  markOvertimeNotified: () => {
    const session = get().session;
    if (!session) return;
    apply(set, markOvertime(session));
  },
}));

export function openFocusRoom(itemId?: string, router?: { push: (href: string) => void }) {
  if (router) navigateTab(router, "/today");
  useUIStore.getState().enterFocus();
  useFocusSessionStore.getState().ensureSession(itemId);
}

export function exitFocusRoom() {
  useUIStore.getState().exitFocusRoom();
}

export function toggleFocusRoom(router?: { push: (href: string) => void }) {
  if (useUIStore.getState().focusMode) exitFocusRoom();
  else openFocusRoom(undefined, router);
}

export function focusOnThis(itemId: string, router?: { push: (href: string) => void }) {
  openFocusRoom(itemId, router);
}

export type { FocusClock };
