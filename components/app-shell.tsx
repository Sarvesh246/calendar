"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Search, Sparkles } from "lucide-react";
import { motion as motionTokens } from "@/lib/motion";
import { Sidebar } from "./sidebar";
import { QuickAddBar } from "./quick-add-bar";
import { ReminderScheduler } from "./reminder-scheduler";
import { UndoToast } from "./undo-toast";
import { DeferredFeedSync } from "./deferred-feed-sync";
import { ConflictToast } from "./conflict-toast";
import { MobileHeaderActions } from "./mobile-header-actions";
import { StorageSync } from "./storage-sync";
import { Button } from "./ui/button";
import { useUIStore } from "@/lib/ui-store";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { cn } from "@/lib/utils";

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
  const pathname = usePathname();
  const onCalendar = pathname === "/calendar";
  const onSettings = pathname === "/settings";
  const onToday = pathname === "/today";

  useKeyboardInset();

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
          ? "pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(var(--safe-bottom)+1.25rem)]"
          : "pb-[calc(var(--safe-bottom)+var(--tab-bar-rest)+5.75rem)] md:min-h-0 md:pt-4 md:pb-6"
      )}
    >
      {!focusMode && <Sidebar />}

      <main
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          !focusMode && "pt-[var(--mobile-header-height)] md:pt-0",
          onCalendar && "md:min-h-0 md:overflow-hidden"
        )}
      >
        {!focusMode && (
          <>
            <MobileHeaderActions />
            <div
              className={cn(
                "mb-3 hidden shrink-0 items-center gap-2 md:flex",
                onCalendar ? "-mx-2 px-2" : "-mx-4 px-4",
                "md:static md:mx-0 md:mb-4 md:px-0"
              )}
            >
              {onToday && (
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
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => setCommandPaletteOpen(true)}
                  aria-label="Search"
                >
                  <Search className="h-4 w-4" strokeWidth={1.9} />
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

        {children}
      </main>

      {!focusMode && !onSettings && !quickAddOpen && (
        <Button
          variant="fab"
          size="fab"
          onClick={openAdd}
          aria-label="Add item"
          className="viewport-pinned-bottom fixed right-4 z-40 md:hidden"
          style={{ bottom: "calc(var(--safe-bottom) + var(--tab-bar-rest) + 5.25rem)" }}
        >
          <Plus className="h-6 w-6" strokeWidth={2.25} />
        </Button>
      )}

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
            className="viewport-pinned-top overlay-scrim-light fixed inset-0 z-[45]"
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
              "viewport-pinned-top fixed inset-x-3 z-[46] md:left-[calc(220px+2.5rem)] md:right-6 md:w-auto",
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
      <DeferredFeedSync />
      <MergeCloudDialog />
      <StorageSync />
    </div>
  );
}
