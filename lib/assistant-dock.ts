"use client";

import { useResolvedPathname } from "./tab-nav";
import { useMediaQuery } from "./use-media-query";
import { useUIStore } from "./ui-store";
import { useWorkspacePrefs } from "./workspace-prefs";

/** The side pane is only there from `lg` up. */
export const DOCK_MEDIA_QUERY = "(min-width: 1024px)";

/**
 * Whether the assistant should open beside the calendar instead of over it:
 * on the calendar, wide enough for its side pane, and not popped out.
 */
export function useAssistantDockable(): boolean {
  const pathname = useResolvedPathname();
  const wide = useMediaQuery(DOCK_MEDIA_QUERY);
  const docked = useWorkspacePrefs((s) => s.assistantDocked);
  const focusMode = useUIStore((s) => s.focusMode);
  return pathname === "/calendar" && wide && docked && !focusMode;
}
