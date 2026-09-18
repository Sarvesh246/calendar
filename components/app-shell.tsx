"use client";

import dynamic from "next/dynamic";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Keyboard, Search, Sparkles } from "lucide-react";
import { FocusView } from "./focus-view";
import { FocusSessionChip, FocusSessionHydrator } from "./focus-session-chip";
import { Scrim } from "@/components/ui/scrim";
import { motion as motionTokens } from "@/lib/motion";
import { Sidebar } from "./sidebar";
import { QuickAddBar } from "./quick-add-bar";
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

const ItemInspector = dynamic(
  () => import("./item-inspector").then((m) => ({ default: m.ItemInspector })),
  { ssr: false }
);
const CommandPalette = dynamic(
  () => import("./command-palette").then((m) => ({ default: m.CommandPalette })),
  { ssr: false }
);
const AIDrawer = dynamic(() => import("./ai-drawer").then((m) => ({ default: m.AIDrawer })), {
  ssr: false,
});
const MergeCloudDialog = dynamic(
  () => import("./merge-cloud-dialog").then((m) => ({ default: m.MergeCloudDialog })),
  { ssr: false }
);
const ClassScheduleSheet = dynamic(
  () => import("./class-schedule-sheet").then((m) => ({ default: m.ClassScheduleSheet })),
  { ssr: false }
);
const FilterSheet = dynamic(
  () => import("./filter-sheet").then((m) => ({ default: m.FilterSheet })),
  { ssr: false }
);

export function AppShell({ children }: { children: React.ReactNode }) {
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const setAIDrawerOpen = useUIStore((s) => s.setAIDrawerOpen);
  const setQuickAddOpen = useUIStore((s) => s.setQuickAddOpen);
  const setQuickAddPrefill = useUIStore((s) => s.setQuickAddPrefill);
  const closeQuickAdd = useUIStore((s) => s.closeQuickAdd);
  const quickAddOpen = useUIStore((s) => s.quickAddOpen);
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
  // Desktop always owns one persistent composer in the command bar. Opening
  // Add from a calendar cell or shortcut focuses and prefills that composer;
  // only phone layouts need the floating sheet.
  const floatingAdd = quickAddOpen && !desktop;
  const [addPresent, setAddPresent] = useState(false);
  useEffect(() => {
    if (floatingAdd) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAddPresent(true);
      return;
    }
    const timer = window.setTimeout(() => setAddPresent(false), motionTokens.exit * 1000 + 30);
    return () => window.clearTimeout(timer);
  }, [floatingAdd]);

  const composerRef = useRef<HTMLDivElement>(null);
  useDialogFocus(composerRef, (floatingAdd || addPresent) && !desktop);
  useLockBodyScroll((floatingAdd || addPresent) && !desktop);
  useKeyboardInset();
  const setShortcutsOpen = useUIStore((s) => s.setShortcutsOpen);
  const modKey = useModKeyLabel();

  // Device layout prefs load after mount so the server render and the first
  // client render agree.
  useEffect(() => {
    void useWorkspacePrefs.persist.rehydrate();
  }, []);

  useEffect(() => {
    closeQuickAdd();
  }, [pathname, closeQuickAdd]);

  const enterFocus = useUIStore((s) => s.enterFocus);
  // Home Screen Quick Actions (Calendar-ios) deep-link with `?intent=…`
  // instead of a native bridge round-trip — "Today" needs nothing here since
  // the wrapper just loads /today directly. Read once into a ref (a pure,
  // side-effect-free read is safe during render) rather than re-reading the
  // URL from the effect body: dev Strict Mode replays effects (close-quick-add
  // then this one) twice in a row, and by the second pass the URL has already
  // been stripped — re-reading it there would silently drop the intent.
  const intentRef = useRef<string | null | undefined>(undefined);
  const intentItemRef = useRef<string | null>(null);
  const intentPrefillRef = useRef<string | null>(null);
  if (intentRef.current === undefined) {
    if (typeof window === "undefined") {
      intentRef.current = null;
    } else {
      const params = new URLSearchParams(window.location.search);
      intentRef.current = params.get("intent");
      intentItemRef.current = params.get("item");
      intentPrefillRef.current = params.get("prefill") ?? params.get("text");
    }
  }
  useEffect(() => {
    const intent = intentRef.current;
    if (!intent) return;
    const itemId = intentItemRef.current;
    const store = useDatebookStore.getState();
    if (intent === "compose" || intent === "add") {
      if (intentPrefillRef.current) setQuickAddPrefill(intentPrefillRef.current);
      else setQuickAddPrefill("");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            <MobileHeaderActions pathname={pathname} />
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
              {desktop && <div aria-hidden className="mx-0.5 h-6 w-px shrink-0 bg-line lg:mx-1" />}
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
                  className="hidden h-10 w-40 items-center gap-2 rounded-lg bg-surface-sunken/70 pl-3 pr-2 text-[13px] text-ink-faint transition-[background-color,color,width] duration-[var(--motion-standard)] hover:bg-surface-sunken hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:flex xl:w-52 2xl:w-60"
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
      <AnimatePresence>
        {floatingAdd && (
          <Scrim
            key="quick-add-scrim"
            label="Dismiss add"
            tone="light"
            pace="snap"
            onPointerDown={closeQuickAdd}
            className="viewport-pinned-top viewport-pinned-overlay fixed inset-0 z-[45]"
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {floatingAdd && (
          <motion.div
            key="quick-add-panel"
            ref={composerRef}
            role={!desktop ? "dialog" : undefined}
            aria-modal={!desktop ? true : undefined}
            aria-label={!desktop ? "Add item" : undefined}
            tabIndex={-1}
            initial={{ opacity: 0, y: -10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{
              opacity: 0,
              y: -8,
              scale: 0.98,
              transition: { duration: motionTokens.exit, ease: motionTokens.easeIn },
            }}
            transition={motionTokens.spring}
            style={{
              top: "calc(env(safe-area-inset-top) + 4.25rem)",
              transformOrigin: "top center",
              willChange: "transform, opacity",
            }}
            className={cn(
              "mobile-composer viewport-pinned-top fixed inset-x-3 z-[46] mx-auto max-h-[calc(var(--visible-height,100dvh)-5rem)] max-w-[760px] overflow-y-auto overscroll-contain md:inset-x-6"
            )}
          >
            <QuickAddBar />
          </motion.div>
        )}
      </AnimatePresence>
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
