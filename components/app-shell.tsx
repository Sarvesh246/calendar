"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Search, Settings } from "lucide-react";
import { motion as motionTokens } from "@/lib/motion";
import { Sidebar } from "./sidebar";
import { QuickAddBar } from "./quick-add-bar";
import { CommandPalette } from "./command-palette";
import { AIDrawer } from "./ai-drawer";
import { ReminderScheduler } from "./reminder-scheduler";
import { UndoToast } from "./undo-toast";
import { FeedSync } from "./feed-sync";
import { MergeCloudDialog } from "./merge-cloud-dialog";
import { ConflictToast } from "./conflict-toast";
import { FilterButton, FilterSheet } from "./filter-sheet";
import { Button } from "./ui/button";
import { useUIStore } from "@/lib/ui-store";
import { useHasMounted } from "@/lib/use-has-mounted";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const setQuickAddOpen = useUIStore((s) => s.setQuickAddOpen);
  const setQuickAddPrefill = useUIStore((s) => s.setQuickAddPrefill);
  const closeQuickAdd = useUIStore((s) => s.closeQuickAdd);
  const quickAddOpen = useUIStore((s) => s.quickAddOpen);
  const focusMode = useUIStore((s) => s.focusMode);
  const pathname = usePathname();
  const onCalendar = pathname === "/calendar";
  const onSettings = pathname === "/settings";
  const onToday = pathname === "/today";

  useKeyboardInset();

  // Several views render "live" time-relative text (countdowns, "today"). Gating
  // real content behind a client-only mount avoids server/client clock drift
  // producing a hydration mismatch — the cost is one blank frame on first load.
  const mounted = useHasMounted();

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
        // Only the desktop calendar locks to the viewport so the month grid
        // fills the pane. Mobile calendar scrolls the document so the selected
        // day's list can sit under the grid (Google Calendar pattern).
        onCalendar ? "min-h-dvh md:h-dvh md:overflow-hidden" : "min-h-dvh",
        focusMode
          ? "pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1.25rem)]"
          : "pb-[calc(env(safe-area-inset-bottom)+5.75rem)] md:min-h-0 md:pt-4 md:pb-6"
      )}
    >
      {!focusMode && <Sidebar />}

      <main
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          onCalendar && "md:min-h-0 md:overflow-hidden"
        )}
      >
        {!focusMode && (
          <div
            className={cn(
              "sticky top-0 z-20 mb-3 flex shrink-0 items-center gap-2 bg-surface-base",
              // Extra clearance above the row: on a notched/Dynamic-Island phone
              // the previous 0.85rem left these icon buttons sitting right at
              // the edge of the safe area, so their top few pixels read as
              // clipped by the status bar / camera cutout.
              "pt-[calc(env(safe-area-inset-top)+1.25rem)] pb-2",
              onCalendar ? "-mx-2 px-2" : "-mx-4 px-4",
              "md:static md:top-auto md:z-auto md:mx-0 md:mb-4 md:bg-transparent md:px-0 md:pt-0 md:pb-0"
            )}
          >
            {onToday && (
              <div className="hidden min-w-0 flex-1 md:block">
                <QuickAddBar embedded />
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="secondary"
                size="icon"
                onClick={() => setCommandPaletteOpen(true)}
                aria-label="Search"
              >
                <Search className="h-4 w-4" strokeWidth={1.9} />
              </Button>
              {!onSettings && <FilterButton className="md:hidden" />}
              <Link
                href="/settings"
                aria-label="Settings"
                className={cn(
                  "inline-flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink md:hidden",
                  onSettings && "border-accent bg-accent-soft text-accent"
                )}
              >
                <Settings className="h-4 w-4" strokeWidth={1.9} />
              </Link>
              {!onSettings && !onToday && (
                <Button variant="primary" size="sm" onClick={openAdd} className="hidden md:inline-flex">
                  <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
                  Add
                </Button>
              )}
            </div>
          </div>
        )}

        {mounted ? children : null}
      </main>

      {!focusMode && !onSettings && !quickAddOpen && (
        <Button
          variant="fab"
          size="fab"
          onClick={openAdd}
          aria-label="Add item"
          className="fixed right-4 z-40 md:hidden"
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 5.25rem)" }}
        >
          <Plus className="h-6 w-6" strokeWidth={2.25} />
        </Button>
      )}

      {mounted && (
        <>
          {/* The plus button used to swap this straight in with a bare
              conditional render — no fade, no travel, just a hard cut. It now
              drops in from just above its resting spot on the same spring
              every other popover in the app uses, and eases back out quicker
              than it arrived. */}
          <AnimatePresence>
            {quickAddOpen && (
              <motion.button
                key="quick-add-scrim"
                type="button"
                aria-label="Dismiss add"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
                className="overlay-scrim-light fixed inset-0 z-[45]"
                onClick={closeQuickAdd}
                onPointerDown={closeQuickAdd}
              />
            )}
          </AnimatePresence>
          <AnimatePresence>
            {quickAddOpen && (
              <motion.div
                key="quick-add-panel"
                initial={{ opacity: 0, y: -10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{
                  opacity: 0,
                  y: -8,
                  scale: 0.98,
                  transition: { duration: motionTokens.exit, ease: motionTokens.easeIn },
                }}
                transition={motionTokens.spring}
                style={{ top: "calc(env(safe-area-inset-top) + 4.25rem)", transformOrigin: "top center" }}
                className={cn(
                  "fixed inset-x-3 z-[46] md:left-[calc(220px+2.5rem)] md:right-6 md:w-auto",
                  onToday && "md:hidden"
                )}
              >
                <QuickAddBar />
              </motion.div>
            )}
          </AnimatePresence>
          <FilterSheet />
          <CommandPalette />
          <AIDrawer />
          <ReminderScheduler />
          <UndoToast />
          <ConflictToast />
          <FeedSync />
          <MergeCloudDialog />
        </>
      )}
    </div>
  );
}
