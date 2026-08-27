"use client";

import { create } from "zustand";

interface UIState {
  commandPaletteOpen: boolean;
  aiDrawerOpen: boolean;
  focusMode: boolean;
  sidebarCollapsed: boolean;
  quickAddOpen: boolean;
  quickAddPrefill: string | null;
  categoryFilter: string[] | null;

  setCommandPaletteOpen: (open: boolean) => void;
  setAIDrawerOpen: (open: boolean) => void;
  toggleFocusMode: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setQuickAddOpen: (open: boolean) => void;
  setQuickAddPrefill: (text: string | null) => void;
  toggleCategoryFilter: (id: string) => void;
  clearCategoryFilter: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  commandPaletteOpen: false,
  aiDrawerOpen: false,
  focusMode: false,
  sidebarCollapsed: false,
  quickAddOpen: false,
  quickAddPrefill: null,
  categoryFilter: null,

  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setAIDrawerOpen: (open) => set({ aiDrawerOpen: open }),
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
}));
