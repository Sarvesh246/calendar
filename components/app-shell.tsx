"use client";

import { Search } from "lucide-react";
import { Sidebar } from "./sidebar";
import { QuickAddBar } from "./quick-add-bar";
import { CommandPalette } from "./command-palette";
import { AIDrawer } from "./ai-drawer";
import { ReminderScheduler } from "./reminder-scheduler";
import { useUIStore } from "@/lib/ui-store";
import { useHasMounted } from "@/lib/use-has-mounted";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";

export function AppShell({ children }: { children: React.ReactNode }) {
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const focusMode = useUIStore((s) => s.focusMode);

  useKeyboardInset();

  // Several views render "live" time-relative text (countdowns, "today"). Gating
  // real content behind a client-only mount avoids server/client clock drift
  // producing a hydration mismatch — the cost is one blank frame on first load.
  const mounted = useHasMounted();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1800px] gap-5 px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-[calc(env(safe-area-inset-bottom)+5.5rem)] md:min-h-0 md:px-6 md:pt-4 md:pb-6">
      {!focusMode && <Sidebar />}

      <main className="min-w-0 flex-1">
        {!focusMode && (
          <div className="mb-5 flex items-center gap-2.5">
            {/* min-w-0 so the bar yields space to the fixed-width search button
                instead of pushing it off the right edge on narrow screens. */}
            <div className="min-w-0 flex-1">
              <QuickAddBar />
            </div>
            <button
              onClick={() => setCommandPaletteOpen(true)}
              aria-label="Search (⌘K)"
              className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-ink-faint transition-colors hover:text-ink"
            >
              <Search className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </div>
        )}

        {mounted ? children : null}
      </main>

      {mounted && (
        <>
          <CommandPalette />
          <AIDrawer />
          <ReminderScheduler />
        </>
      )}
    </div>
  );
}
