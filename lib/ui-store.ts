"use client";

import { create } from "zustand";

interface UIState {
  commandPaletteOpen: boolean;
  filterOpen: boolean;
  aiDrawerOpen: boolean;
  /** A message to auto-send once the AI drawer opens (from the quick-add bar). */
  aiDrawerPendingMessage: string | null;
  focusMode: boolean;
  sidebarCollapsed: boolean;
  quickAddOpen: boolean;
  quickAddPrefill: string | null;
  categoryFilter: string[] | null;
  focusedItemId: string | null;
  quickAddDateKey: string | null;
  quickAddTime: { hour: number; minute: number } | null;
  calendarFocusDate: string | null;

  setCommandPaletteOpen: (open: boolean) => void;
  setFilterOpen: (open: boolean) => void;
  setAIDrawerOpen: (open: boolean) => void;
  /** Open the AI drawer and queue a message for it to answer. */
  askAI: (message: string) => void;
  consumeAIDrawerPendingMessage: () => string | null;
  toggleFocusMode: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setQuickAddOpen: (open: boolean) => void;
  closeQuickAdd: () => void;
  setQuickAddPrefill: (text: string | null) => void;
  toggleCategoryFilter: (id: string) => void;
  clearCategoryFilter: () => void;
  setFocusedItemId: (id: string | null) => void;
  setQuickAddDateKey: (key: string | null) => void;
  setQuickAddTime: (time: { hour: number; minute: number } | null) => void;
  setCalendarFocusDate: (key: string | null) => void;
}

const closedAdd = {
  quickAddOpen: false,
  quickAddDateKey: null,
  quickAddTime: null,
} as const;

export const useUIStore = create<UIState>((set, get) => ({
  commandPaletteOpen: false,
  filterOpen: false,
  aiDrawerOpen: false,
  aiDrawerPendingMessage: null,
  focusMode: false,
  sidebarCollapsed: false,
  quickAddOpen: false,
  quickAddPrefill: null,
  categoryFilter: null,
  focusedItemId: null,
  quickAddDateKey: null,
  quickAddTime: null,
  calendarFocusDate: null,

  setCommandPaletteOpen: (open) =>
    set(open ? { commandPaletteOpen: true, ...closedAdd } : { commandPaletteOpen: false }),
  setFilterOpen: (open) =>
    set(open ? { filterOpen: true, ...closedAdd } : { filterOpen: false }),
  setAIDrawerOpen: (open) =>
    set(open ? { aiDrawerOpen: true, ...closedAdd } : { aiDrawerOpen: false }),
  askAI: (message) =>
    set({ aiDrawerOpen: true, aiDrawerPendingMessage: message.trim() || null, ...closedAdd }),
  consumeAIDrawerPendingMessage: () => {
    const msg = get().aiDrawerPendingMessage;
    if (msg !== null) set({ aiDrawerPendingMessage: null });
    return msg;
  },
  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setQuickAddOpen: (open) => set(open ? { quickAddOpen: true } : closedAdd),
  closeQuickAdd: () => set(closedAdd),
  setQuickAddPrefill: (text) => set({ quickAddPrefill: text }),
  toggleCategoryFilter: (id) =>
    set((s) => {
      const current = s.categoryFilter ?? [];
      const next = current.includes(id) ? current.filter((c) => c !== id) : [...current, id];
      return { categoryFilter: next.length === 0 ? null : next };
    }),
  clearCategoryFilter: () => set({ categoryFilter: null }),
  setFocusedItemId: (id) => set({ focusedItemId: id }),
  setQuickAddDateKey: (key) => set({ quickAddDateKey: key }),
  setQuickAddTime: (time) => set({ quickAddTime: time }),
  setCalendarFocusDate: (key) => set({ calendarFocusDate: key }),
}));
