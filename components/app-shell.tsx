"use client";

import dynamic from "next/dynamic";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";
import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Keyboard, Plus, Search, Sparkles } from "lucide-react";
import { Scrim } from "@/components/ui/scrim";
import { motion as motionTokens } from "@/lib/motion";
import { Sidebar } from "./sidebar";
import { QuickAddBar } from "./quick-add-bar";
import { ReminderScheduler } from "./reminder-scheduler";
import { DeferredFeedSync } from "./deferred-feed-sync";
import { ToastViewport } from "./toast-viewport";
import { MobileHeaderActions } from "./mobile-header-actions";
import { FilterSummaryBar } from "./filter-summary-bar";
import { ViewStateSync } from "./view-state-sync";
import { StorageSync } from "./storage-sync";
import { Button } from "./ui/button";
import { useUIStore } from "@/lib/ui-store";
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
  const onToday = pathname === "/today";
  const onTab = isTabRoute(pathname);
  const desktop = useMediaQuery("(min-width: 768px)");
  const floatingAdd = quickAddOpen && !(onToday && desktop);

  const composerRef = useRef<HTMLDivElement>(null);
  useDialogFocus(composerRef, floatingAdd && !desktop);
  useLockBodyScroll(floatingAdd && !desktop);
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

  function openAdd() {
    setQuickAddPrefill("");
    setQuickAddOpen(true);
  }

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-[1800px] gap-5",
        onCalendar ? "px-2 md:px-6" : "px-4 md:px-6",
        // Keep the calendar in the viewport; only its day lists scroll.
        onCalendar ? "h-dvh overflow-hidden" : "min-h-dvh",
        focusMode
          ? "pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(var(--safe-bottom)+1.25rem)]"
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
              className={cn(
                "mb-3 hidden shrink-0 items-center gap-2 md:flex",
                onCalendar ? "-mx-2 px-2" : "-mx-4 px-4",
                "md:static md:mx-0 md:mb-4 md:px-0"
              )}
            >
              {onToday && desktop && (
                <div className="min-w-0 flex-1">
                  <QuickAddBar embedded />
                </div>
              )}
              <div className="ml-auto flex items-center gap-2">
                {/* The assistant used to be reachable only from inside the
                    command palette, which meant you had to already know it
                    existed. It sits in the toolbar now, labelled. */}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setAIDrawerOpen(true)}
                  aria-label="Ask the assistant"
                >
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
                  Ask
                </Button>
                {/* Where there's room, search looks like a field with its
                    shortcut on it — an icon alone never taught anyone ⌘K. */}
                <button
                  type="button"
                  onClick={() => setCommandPaletteOpen(true)}
                  aria-label="Search"
                  aria-keyshortcuts="Control+K Meta+K"
                  className="hidden h-9 w-52 items-center gap-2 rounded-md border border-line bg-surface pl-2.5 pr-1.5 text-[13px] text-ink-faint transition-colors duration-[var(--motion-standard)] hover:border-line-strong hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:flex xl:w-64"
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
                  className="lg:hidden"
                >
                  <Search className="h-4 w-4" strokeWidth={1.9} />
                </Button>
                <Button
                  variant="tertiary"
                  size="iconSm"
                  onClick={() => setShortcutsOpen(true)}
                  aria-label="Keyboard shortcuts"
                  title="Keyboard shortcuts (?)"
                  className="hidden lg:inline-flex"
                >
                  <Keyboard className="h-4 w-4" strokeWidth={1.9} />
                </Button>
                {!onSettings && !onToday && (
                  <Button variant="primary" size="sm" onClick={openAdd}>
                    <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
                    Add
                  </Button>
                )}
              </div>
            </div>
          </>
        )}

        {/* Above the page's own title on purpose: a filter silently deleting
            things from every screen has to be the first thing you see, not
            something below the fold of a scrolled list. */}
        {!focusMode && <FilterSummaryBar />}

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
      <ToastViewport />
      <DeferredFeedSync />
      <MergeCloudDialog />
      <StorageSync />
      <BootSplash />
    </div>
  );
}
