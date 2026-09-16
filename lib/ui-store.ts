"use client";

import { startTransition, useDeferredValue } from "react";
import { create } from "zustand";
import type { SavedView, ViewFilter } from "./views";

export type CalendarCommand =
  | { kind: "today" }
  | { kind: "mode"; mode: "month" | "week" }
  | { kind: "step"; dir: 1 | -1 }
  | { kind: "toggle-pane" }
  | { kind: "jump" };

export interface ContextMenuRequest {
  itemId: string;
  x: number;
  y: number;
  /** The day the item was shown on — a multi-day event moves from there. */
  dayKey?: string;
  /** Open straight onto the reschedule choices. */
  section?: "reschedule";
}

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
  /** Length of a span swept out on the week grid, applied to a new event. */
  quickAddDurationMin: number | null;
  calendarFocusDate: string | null;
  classScheduleOpen: boolean;
  classScheduleCategoryId: string | null;
  /** The saved view narrowing every list, if any. */
  activeViewId: string | null;
  viewFilter: ViewFilter | null;
  /** The item open in the shared detail inspector. */
  inspectorItemId: string | null;
  contextMenu: ContextMenuRequest | null;
  shortcutsOpen: boolean;
  /** A keyboard shortcut aimed at the calendar; `nonce` makes repeats distinct. */
  calendarCommand: (CalendarCommand & { nonce: number }) | null;

  setCommandPaletteOpen: (open: boolean) => void;
  setFilterOpen: (open: boolean) => void;
  setAIDrawerOpen: (open: boolean) => void;
  /** Open the AI drawer and queue a message for it to answer. */
  askAI: (message: string) => void;
  consumeAIDrawerPendingMessage: () => string | null;
  toggleFocusMode: () => void;
  enterFocus: () => void;
  exitFocusRoom: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setQuickAddOpen: (open: boolean) => void;
  closeQuickAdd: () => void;
  setQuickAddPrefill: (text: string | null) => void;
  toggleCategoryFilter: (id: string) => void;
  clearCategoryFilter: () => void;
  /** View, classes, and leftover view rules — not "hide completed". */
  clearAllFilters: () => void;
  setFocusedItemId: (id: string | null) => void;
  setQuickAddDateKey: (key: string | null) => void;
  setQuickAddTime: (time: { hour: number; minute: number } | null) => void;
  setQuickAddDurationMin: (minutes: number | null) => void;
  setCalendarFocusDate: (key: string | null) => void;
  openClassSchedule: (categoryId?: string | null) => void;
  closeClassSchedule: () => void;
  applyView: (view: SavedView | null) => void;
  openInspector: (id: string) => void;
  closeInspector: () => void;
  openContextMenu: (request: ContextMenuRequest) => void;
  closeContextMenu: () => void;
  setShortcutsOpen: (open: boolean) => void;
  sendCalendarCommand: (command: CalendarCommand) => void;
}

const closedAdd = {
  quickAddOpen: false,
  quickAddDateKey: null,
  quickAddTime: null,
  quickAddDurationMin: null,
} as const;

/**
 * Full-screen and modal surfaces are peers: only one may own the viewport at a
 * time. Keeping this in the store makes opening the next surface atomic. If
 * two independent setters leave both flags true, the older surface can finish
 * an exit above the newer one and make its trigger appear to have frozen.
 */
const closedPrimarySurfaces = {
  commandPaletteOpen: false,
  filterOpen: false,
  aiDrawerOpen: false,
  aiDrawerPendingMessage: null,
  classScheduleOpen: false,
  classScheduleCategoryId: null,
  shortcutsOpen: false,
  contextMenu: null,
} as const;

/**
 * The category filter for views that re-filter and re-render every item.
 * Zustand updates reach React through `useSyncExternalStore`, which always
 * renders synchronously — `startTransition` around `set` does not defer it —
 * so reading the raw value made a filter tap block paint on all mounted pages.
 * Deferring here lets the sidebar/filter controls respond first.
 */
export function useDeferredCategoryFilter() {
  const live = useUIStore((s) => s.categoryFilter);
  const deferred = useDeferredValue(live);
  // Turning a filter *off* has to be immediate. Deferring a leftover selection
  // after Clear is how the empty state kept saying things were filtered out.
  return live == null || live.length === 0 ? live : deferred;
}

let commandNonce = 0;

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
  quickAddDurationMin: null,
  calendarFocusDate: null,
  classScheduleOpen: false,
  classScheduleCategoryId: null,
  activeViewId: null,
  viewFilter: null,
  inspectorItemId: null,
  contextMenu: null,
  shortcutsOpen: false,
  calendarCommand: null,

  setCommandPaletteOpen: (open) =>
    set(open ? { ...closedPrimarySurfaces, commandPaletteOpen: true, ...closedAdd } : { commandPaletteOpen: false }),
  setFilterOpen: (open) =>
    set(open ? { ...closedPrimarySurfaces, filterOpen: true, ...closedAdd } : { filterOpen: false }),
  setAIDrawerOpen: (open) =>
    set(open ? { ...closedPrimarySurfaces, aiDrawerOpen: true, ...closedAdd } : { aiDrawerOpen: false }),
  askAI: (message) =>
    set({ ...closedPrimarySurfaces, aiDrawerOpen: true, aiDrawerPendingMessage: message.trim() || null, ...closedAdd }),
  consumeAIDrawerPendingMessage: () => {
    const msg = get().aiDrawerPendingMessage;
    if (msg !== null) set({ aiDrawerPendingMessage: null });
    return msg;
  },
  enterFocus: () =>
    set({ ...closedPrimarySurfaces, ...closedAdd, focusMode: true, inspectorItemId: null }),
  exitFocusRoom: () => set({ focusMode: false }),
  toggleFocusMode: () => {
    const s = get();
    if (s.focusMode) s.exitFocusRoom();
    else s.enterFocus();
  },
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setQuickAddOpen: (open) =>
    set(open ? { ...closedPrimarySurfaces, quickAddOpen: true } : closedAdd),
  closeQuickAdd: () => set(closedAdd),
  setQuickAddPrefill: (text) => set({ quickAddPrefill: text }),
  toggleCategoryFilter: (id) =>
    startTransition(() =>
      set((s) => {
        const current = s.categoryFilter ?? [];
        const next = current.includes(id) ? current.filter((c) => c !== id) : [...current, id];
        return { categoryFilter: next.length === 0 ? null : next };
      })
    ),
  clearCategoryFilter: () => set({ categoryFilter: null }),
  clearAllFilters: () => set({ activeViewId: null, viewFilter: null, categoryFilter: null }),
  setFocusedItemId: (id) => set({ focusedItemId: id }),
  setQuickAddDateKey: (key) => set({ quickAddDateKey: key }),
  setQuickAddTime: (time) => set({ quickAddTime: time }),
  setQuickAddDurationMin: (minutes) => set({ quickAddDurationMin: minutes }),
  setCalendarFocusDate: (key) => set({ calendarFocusDate: key }),
  openClassSchedule: (categoryId) =>
    set({ ...closedPrimarySurfaces, classScheduleOpen: true, classScheduleCategoryId: categoryId ?? null, ...closedAdd }),
  closeClassSchedule: () => set({ classScheduleOpen: false, classScheduleCategoryId: null }),
  applyView: (view) => {
    if (!view) {
      set({ activeViewId: null, viewFilter: null, categoryFilter: null });
      return;
    }
    startTransition(() =>
      set(() => {
        const filter: ViewFilter = {
          ...(view.statuses?.length ? { statuses: view.statuses } : {}),
          ...(view.kinds?.length ? { kinds: view.kinds } : {}),
          ...(view.range && view.range !== "any" ? { range: view.range } : {}),
        };
        return {
          activeViewId: view.id,
          viewFilter: Object.keys(filter).length ? filter : null,
          // A view is a whole combination: its classes replace whatever
          // was picked before, and "no classes" means all of them.
          categoryFilter: view.categoryIds?.length ? [...view.categoryIds] : null,
        };
      })
    );
  },
  openInspector: (id) => set({ inspectorItemId: id, contextMenu: null }),
  closeInspector: () => set({ inspectorItemId: null }),
  openContextMenu: (request) => set({ contextMenu: request }),
  closeContextMenu: () => set({ contextMenu: null }),
  setShortcutsOpen: (open) =>
    set(open ? { ...closedPrimarySurfaces, shortcutsOpen: true, ...closedAdd } : { shortcutsOpen: false }),
  sendCalendarCommand: (command) => set({ calendarCommand: { ...command, nonce: ++commandNonce } }),
}));
