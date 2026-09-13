"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { nanoid } from "./nanoid";
import { sanitizeSavedViews, type SavedView } from "./views";

/**
 * How this device lays out its workspace: the calendar's view, the side pane's
 * width and tab, the agenda's layout, saved views. These are about the screen
 * in front of you, not the calendar itself, so they stay local rather than
 * syncing — a wide desktop pane has no business resizing a phone.
 */
export type CalendarMode = "month" | "week";
export type PaneTab = "day" | "plan" | "assistant";
export type AgendaLayout = "cards" | "rows";

export const PANE_MIN_WIDTH = 300;
export const PANE_MAX_WIDTH = 640;
export const PANE_DEFAULT_WIDTH = 352;
export const SESSION_LENGTHS = [30, 60, 90, 120] as const;

export function clampPaneWidth(width: unknown): number {
  if (typeof width !== "number" || !Number.isFinite(width)) return PANE_DEFAULT_WIDTH;
  return Math.round(Math.min(PANE_MAX_WIDTH, Math.max(PANE_MIN_WIDTH, width)));
}

interface WorkspacePrefsData {
  calendarMode: CalendarMode;
  paneWidth: number;
  paneCollapsed: boolean;
  paneTab: PaneTab;
  /** Open the assistant beside the calendar (desktop) instead of over it. */
  assistantDocked: boolean;
  agendaLayout: AgendaLayout;
  sessionMinutes: number;
  savedViews: SavedView[];
}

interface WorkspacePrefsState extends WorkspacePrefsData {
  setCalendarMode: (mode: CalendarMode) => void;
  setPaneWidth: (width: number) => void;
  setPaneCollapsed: (collapsed: boolean) => void;
  setPaneTab: (tab: PaneTab) => void;
  setAssistantDocked: (docked: boolean) => void;
  setAgendaLayout: (layout: AgendaLayout) => void;
  setSessionMinutes: (minutes: number) => void;
  addSavedView: (view: Omit<SavedView, "id" | "builtIn">) => SavedView;
  removeSavedView: (id: string) => void;
}

const DEFAULTS: WorkspacePrefsData = {
  calendarMode: "month",
  paneWidth: PANE_DEFAULT_WIDTH,
  paneCollapsed: false,
  paneTab: "day",
  assistantDocked: true,
  agendaLayout: "cards",
  sessionMinutes: 60,
  savedViews: [],
};

export function sanitizeWorkspacePrefs(raw: unknown): WorkspacePrefsData {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    calendarMode: r.calendarMode === "week" ? "week" : "month",
    paneWidth: clampPaneWidth(r.paneWidth),
    paneCollapsed: r.paneCollapsed === true,
    paneTab: r.paneTab === "plan" || r.paneTab === "assistant" ? r.paneTab : "day",
    assistantDocked: r.assistantDocked !== false,
    agendaLayout: r.agendaLayout === "rows" ? "rows" : "cards",
    sessionMinutes: (SESSION_LENGTHS as readonly number[]).includes(r.sessionMinutes as number)
      ? (r.sessionMinutes as number)
      : 60,
    savedViews: sanitizeSavedViews(r.savedViews),
  };
}

export const useWorkspacePrefs = create<WorkspacePrefsState>()(
  persist(
    (set, get) => ({
      ...DEFAULTS,
      setCalendarMode: (calendarMode) => set({ calendarMode }),
      setPaneWidth: (width) => set({ paneWidth: clampPaneWidth(width) }),
      setPaneCollapsed: (paneCollapsed) => set({ paneCollapsed }),
      setPaneTab: (paneTab) => set({ paneTab }),
      setAssistantDocked: (assistantDocked) => set({ assistantDocked }),
      setAgendaLayout: (agendaLayout) => set({ agendaLayout }),
      setSessionMinutes: (minutes) =>
        set({ sessionMinutes: (SESSION_LENGTHS as readonly number[]).includes(minutes) ? minutes : 60 }),
      addSavedView: (view) => {
        const saved: SavedView = { ...view, id: `view-${nanoid()}` };
        const next = sanitizeSavedViews([...get().savedViews, saved]);
        set({ savedViews: next });
        return next.find((v) => v.id === saved.id) ?? saved;
      },
      removeSavedView: (id) => set({ savedViews: get().savedViews.filter((v) => v.id !== id) }),
    }),
    {
      name: "datebook-workspace",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Rehydrated from AppShell after mount, so server and first client
      // render agree and the saved layout lands one frame later.
      skipHydration: true,
      partialize: (s): WorkspacePrefsData => ({
        calendarMode: s.calendarMode,
        paneWidth: s.paneWidth,
        paneCollapsed: s.paneCollapsed,
        paneTab: s.paneTab,
        assistantDocked: s.assistantDocked,
        agendaLayout: s.agendaLayout,
        sessionMinutes: s.sessionMinutes,
        savedViews: s.savedViews,
      }),
      merge: (persisted, current) => ({ ...current, ...sanitizeWorkspacePrefs(persisted) }),
    }
  )
);
