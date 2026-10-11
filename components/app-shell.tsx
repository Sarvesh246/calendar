"use client";

import { lazyComponent } from "@/lib/lazy-component";
import { registerWarmUp, warmUp } from "@/lib/warm-chunks";
import { useEffect, useRef, useState } from "react";
import { Keyboard, Search, Sparkles } from "lucide-react";
import { FocusView } from "./focus-view";
import { FocusSessionChip, FocusSessionHydrator } from "./focus-session-chip";
import { Sidebar } from "./sidebar";
import { QuickAddBar } from "./quick-add-bar";
import { FloatingComposer } from "./floating-composer";
import { ReminderScheduler } from "./reminder-scheduler";
import { NativeShellSync } from "./native-shell-sync";
import { DeferredFeedSync } from "./deferred-feed-sync";
import { ToastViewport } from "./toast-viewport";
import { MobileHeaderActions } from "./mobile-header-actions";
import { FilterSummaryBar } from "./filter-summary-bar";
import { FilterButton } from "./filter-sheet";
import { ViewStateSync } from "./view-state-sync";
import { StorageSync } from "./storage-sync";
import { Button } from "./ui/button";
import { useUIStore } from "@/lib/ui-store";
import { useDatebookStore } from "@/lib/store";
import { useFocusSessionStore } from "@/lib/focus-session-store";
import { setStatusWithUndo } from "@/lib/item-actions";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { FocusedItemRelay } from "@/lib/item-focus";
import { isTabRoute } from "@/lib/tab-routes";
import { useResolvedPathname } from "@/lib/tab-nav";
import { TabPageHost } from "@/components/tab-page-host";
import { BootSplash } from "@/components/boot-splash";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/lib/use-media-query";
import { useWorkspacePrefs } from "@/lib/workspace-prefs";
import { KeyboardShortcuts, Kbd, useModKeyLabel } from "./keyboard-shortcuts";
import { ItemContextMenu } from "./item-context-menu";
import { DragOverlay } from "./drag-overlay";

// Overlays are split out of the first load and fetched while idle (see
// lib/warm-chunks.ts); once in, they open in the same frame as the tap.
const ItemInspector = lazyComponent<object>(() => import("./item-inspector").then((m) => m.ItemInspector));
registerWarmUp(ItemInspector.preload);
const CommandPalette = lazyComponent<object>(() => import("./command-palette").then((m) => m.CommandPalette));
registerWarmUp(CommandPalette.preload);
const AIDrawer = lazyComponent<object>(() => import("./ai-drawer").then((m) => m.AIDrawer));
registerWarmUp(AIDrawer.preload);
const MergeCloudDialog = lazyComponent<object>(() => import("./merge-cloud-dialog").then((m) => m.MergeCloudDialog));
registerWarmUp(MergeCloudDialog.preload);
const ClassScheduleSheet = lazyComponent<object>(() => import("./class-schedule-sheet").then((m) => m.ClassScheduleSheet));
registerWarmUp(ClassScheduleSheet.preload);
const FilterSheet = lazyComponent<object>(() => import("./filter-sheet").then((m) => m.FilterSheet));
registerWarmUp(FilterSheet.preload);

export function AppShell({ children }: { children: React.ReactNode }) {
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const setAIDrawerOpen = useUIStore((s) => s.setAIDrawerOpen);
  const setQuickAddOpen = useUIStore((s) => s.setQuickAddOpen);
  const setQuickAddPrefill = useUIStore((s) => s.setQuickAddPrefill);
  const closeQuickAdd = useUIStore((s) => s.closeQuickAdd);
  const focusMode = useUIStore((s) => s.focusMode);
  // The tapped tab, not the one the router has got around to committing —
  // see lib/tab-nav.ts. Everything below draws from this, so a switch paints
  // on the same frame as the tap.
  const pathname = useResolvedPathname();
  const onCalendar = pathname === "/calendar";
  const onSettings = pathname === "/settings";
  const onSchedule = pathname === "/schedule";
  const onRoom = onSettings || onSchedule;
  const onToday = pathname === "/today";
  const onTab = isTabRoute(pathname);
  const desktop = useMediaQuery("(min-width: 768px)");
  useKeyboardInset();
  const setShortcutsOpen = useUIStore((s) => s.setShortcutsOpen);
  const modKey = useModKeyLabel();

  // Fetch every on-demand panel once the first screen has settled.
  useEffect(() => warmUp(), []);

  // Device layout prefs load after mount so the server render and the first
  // client render agree.
  useEffect(() => {
    void useWorkspacePrefs.persist.rehydrate();
  }, []);

  // Leaving a page closes its composer. Only on a real change of page: the
  // mount pass (and dev Strict Mode's replay of it) must not close a composer
  // a launch intent below has just opened.
  const shownPath = useRef(pathname);
  useEffect(() => {
    if (shownPath.current === pathname) return;
    shownPath.current = pathname;
    closeQuickAdd();
  }, [pathname, closeQuickAdd]);

  const enterFocus = useUIStore((s) => s.enterFocus);
  // Home Screen Quick Actions (Calendar-ios) deep-link with `?intent=…`
  // instead of a native bridge round-trip — "Today" needs nothing here since
  // the wrapper just loads /today directly. Read once, at mount, into state:
  // the effect strips the URL, so a replayed effect re-reading it would find
  // nothing. `handled` keeps a replay from completing or snoozing twice.
  const [launchIntent] = useState(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const intent = params.get("intent");
    return intent
      ? { intent, itemId: params.get("item"), prefill: params.get("prefill") ?? params.get("text") }
      : null;
  });
  const intentHandled = useRef(false);
  useEffect(() => {
    if (!launchIntent || intentHandled.current) return;
    intentHandled.current = true;
    const { intent, itemId, prefill } = launchIntent;
    const store = useDatebookStore.getState();
    if (intent === "compose" || intent === "add") {
      setQuickAddPrefill(prefill ?? "");
      setQuickAddOpen(true);
    } else if (intent === "focus") {
      if (itemId) useFocusSessionStore.getState().ensureSession(itemId);
      enterFocus();
    } else if (intent === "complete" && itemId) {
      const item = store.items.find((i) => i.id === itemId);
      if (item) setStatusWithUndo(item, "done");
    } else if (intent === "snooze" && itemId) {
      store.snoozeItem(itemId, 15);
    } else if (intent === "item" && itemId) {
      useUIStore.getState().openInspector(itemId);
    }
    const params = new URLSearchParams(window.location.search);
    for (const key of ["intent", "item", "prefill", "text", "snooze"]) params.delete(key);
    const rest = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
  }, [launchIntent, enterFocus, setQuickAddOpen, setQuickAddPrefill]);

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-[1800px] gap-5",
        onCalendar ? "px-2 md:px-6" : "px-4 md:px-6",
        // Keep the calendar in the viewport; only its day lists scroll.
        // Settings/Schedule are content-sized: min-h-dvh + the tab-bar
        // padding below let an open 1fr accordion resolve against the
        // leftover floor and grow a huge empty region under the last card.
        onCalendar ? "h-dvh overflow-hidden" : onRoom ? "min-h-0" : "min-h-dvh",
        focusMode
          ? "pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(var(--safe-bottom)+1.25rem)]"
          : onRoom
            ? "pb-[calc(var(--safe-bottom)+var(--dock-clearance))] md:min-h-0 md:pt-4 md:pb-6"
            : "pb-[calc(var(--safe-bottom)+var(--tab-bar-rest)+5.75rem)] md:min-h-0 md:pt-4 md:pb-6"
      )}
    >
      {!focusMode && <Sidebar pathname={pathname} />}

      <main
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          !focusMode && "pt-[var(--mobile-header-height)] md:pt-0",
          onCalendar && "min-h-0 overflow-hidden"
        )}
      >
        {!focusMode && (
          <>
            <MobileHeaderActions />
            <div
              aria-label="Workspace commands"
              className={cn(
                "mb-4 hidden w-full min-w-0 shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface p-1.5 shadow-[0_1px_0_color-mix(in_srgb,var(--ink)_4%,transparent),0_8px_24px_color-mix(in_srgb,var(--ink)_3%,transparent)] md:flex",
                onToday && "md:mb-5"
              )}
            >
              {desktop && (
                <div className="min-w-0 flex-1">
                  <QuickAddBar embedded toolbar />
                </div>
              )}
              {desktop && <div aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" />}
              <div className="ml-auto flex shrink-0 items-center gap-0.5 lg:gap-1">
                <FocusSessionChip />
                {/* The assistant used to be reachable only from inside the
                    command palette, which meant you had to already know it
                    existed. It sits in the toolbar now, labelled. */}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setAIDrawerOpen(true)}
                  aria-label="Ask the assistant"
                  title="Ask the assistant (A)"
                  className="h-10 rounded-lg border-0 bg-transparent px-3 hover:bg-surface-sunken"
                >
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
                  Ask
                </Button>
                <FilterButton className="hidden h-10 w-10 rounded-lg border-0 bg-transparent shadow-none hover:bg-surface-sunken md:inline-flex" />
                {/* Where there's room, search looks like a field with its
                    shortcut on it — an icon alone never taught anyone ⌘K. */}
                <button
                  type="button"
                  onClick={() => setCommandPaletteOpen(true)}
                  aria-label="Search"
                  aria-keyshortcuts="Control+K Meta+K"
                  title="Search everything"
                  className="hidden h-10 w-40 items-center gap-2 rounded-lg border border-line/70 bg-surface-sunken/50 pl-3 pr-2 text-[13px] text-ink-faint transition-[background-color,color,width] duration-[var(--motion-standard)] hover:bg-surface-sunken hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:flex xl:w-52 2xl:w-60"
                >
                  <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                  <span className="flex-1 text-left">Search…</span>
                  <Kbd>{modKey} K</Kbd>
                </button>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => setCommandPaletteOpen(true)}
                  aria-label="Search"
                  className="h-10 w-10 rounded-lg border-0 bg-transparent lg:hidden"
                >
                  <Search className="h-4 w-4" strokeWidth={1.9} />
                </Button>
                <Button
                  variant="tertiary"
                  size="iconSm"
                  onClick={() => setShortcutsOpen(true)}
                  aria-label="Keyboard shortcuts"
                  title="Keyboard shortcuts (?)"
                  className="hidden h-10 w-10 rounded-lg lg:inline-flex"
                >
                  <Keyboard className="h-4 w-4" strokeWidth={1.9} />
                </Button>
              </div>
            </div>
          </>
        )}

        {/* Above the page's own title on purpose: a filter silently deleting
            things from every screen has to be the first thing you see, not
            something below the fold of a scrolled list. */}
        {!focusMode && <FilterSummaryBar />}

        {focusMode ? (
          <FocusView />
        ) : (
          <>
            <div
              hidden={!onTab}
              className={cn(
                onTab && "flex min-h-0 flex-1 flex-col",
                onCalendar && "overflow-hidden"
              )}
            >
              <TabPageHost pathname={pathname} />
            </div>
            {!onTab && children}
          </>
        )}
      </main>

      <ViewStateSync />
      <FloatingComposer />
      <FocusSessionHydrator />
      <FocusedItemRelay />
      <KeyboardShortcuts />
      <ItemContextMenu />
      <ItemInspector />
      <DragOverlay />
      <ClassScheduleSheet />
      <FilterSheet />
      <CommandPalette />
      <AIDrawer />
      <ReminderScheduler />
      <NativeShellSync />
      <ToastViewport />
      <DeferredFeedSync />
      <MergeCloudDialog />
      <StorageSync />
      <BootSplash />
    </div>
  );
}
