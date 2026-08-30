"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Plus, Search, Settings } from "lucide-react";
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
  const setQuickAddDateKey = useUIStore((s) => s.setQuickAddDateKey);
  const setQuickAddTime = useUIStore((s) => s.setQuickAddTime);
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

  function openAdd() {
    setQuickAddPrefill("");
    setQuickAddOpen(true);
  }

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-[1800px] gap-5 px-4",
        // Only the desktop calendar locks to the viewport so the month grid
        // fills the pane. Mobile calendar scrolls the document so the selected
        // day's list can sit under the grid (Google Calendar pattern).
        onCalendar
          ? "min-h-dvh md:h-dvh md:overflow-hidden"
          : "min-h-dvh",
        focusMode
          ? "pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1.25rem)]"
          : "pt-[calc(env(safe-area-inset-top)+1.25rem)] pb-[calc(env(safe-area-inset-bottom)+5.75rem)] md:min-h-0 md:px-6 md:pt-4 md:pb-6"
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
          <div className="mb-3 flex shrink-0 items-center gap-2 md:mb-4">
            {onToday && (
              <div className="hidden min-w-0 flex-1 md:block">
                <QuickAddBar embedded />
              </div>
            )}
            {!onToday && <div className="min-w-0 flex-1" />}
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
        )}

        {mounted ? children : null}
      </main>

      {!focusMode && !onSettings && (
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
          {quickAddOpen && (
            <button
              type="button"
              aria-label="Dismiss add"
              className="overlay-scrim-light fixed inset-0 z-30"
              onClick={() => {
                setQuickAddOpen(false);
                setQuickAddDateKey(null);
                setQuickAddTime(null);
              }}
            />
          )}
          {quickAddOpen && !onToday && (
            <div className="fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-40 mx-auto w-[calc(100%-2rem)] max-w-[640px] md:left-[calc(220px+2.5rem)] md:right-6 md:w-auto">
              <QuickAddBar />
            </div>
          )}
          {quickAddOpen && onToday && (
            <div className="fixed inset-x-4 top-[max(0.75rem,env(safe-area-inset-top))] z-40 md:hidden">
              <QuickAddBar />
            </div>
          )}
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
