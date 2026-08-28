"use client";

import { create } from "zustand";

interface UIState {
  commandPaletteOpen: boolean;
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
  calendarFocusDate: string | null;

  setCommandPaletteOpen: (open: boolean) => void;
  setAIDrawerOpen: (open: boolean) => void;
  /** Open the AI drawer and queue a message for it to answer. */
  askAI: (message: string) => void;
  consumeAIDrawerPendingMessage: () => string | null;
  toggleFocusMode: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setQuickAddOpen: (open: boolean) => void;
  setQuickAddPrefill: (text: string | null) => void;
  toggleCategoryFilter: (id: string) => void;
  clearCategoryFilter: () => void;
  setFocusedItemId: (id: string | null) => void;
  setQuickAddDateKey: (key: string | null) => void;
  setCalendarFocusDate: (key: string | null) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  commandPaletteOpen: false,
  aiDrawerOpen: false,
  aiDrawerPendingMessage: null,
  focusMode: false,
  sidebarCollapsed: false,
  quickAddOpen: false,
  quickAddPrefill: null,
  categoryFilter: null,
  focusedItemId: null,
  quickAddDateKey: null,
  calendarFocusDate: null,

  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setAIDrawerOpen: (open) => set({ aiDrawerOpen: open }),
  askAI: (message) => set({ aiDrawerOpen: true, aiDrawerPendingMessage: message.trim() || null }),
  consumeAIDrawerPendingMessage: () => {
    const msg = get().aiDrawerPendingMessage;
    if (msg !== null) set({ aiDrawerPendingMessage: null });
    return msg;
  },
  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setQuickAddOpen: (open) => set({ quickAddOpen: open }),
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
  setCalendarFocusDate: (key) => set({ calendarFocusDate: key }),
}));
