"use client";

import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { Sidebar } from "./sidebar";
import { QuickAddBar } from "./quick-add-bar";
import { CommandPalette } from "./command-palette";
import { AIDrawer } from "./ai-drawer";
import { ReminderScheduler } from "./reminder-scheduler";
import { CategoryChips } from "./category-chips";
import { useUIStore } from "@/lib/ui-store";
import { useHasMounted } from "@/lib/use-has-mounted";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const focusMode = useUIStore((s) => s.focusMode);
  const pathname = usePathname();

  useKeyboardInset();

  // Several views render "live" time-relative text (countdowns, "today"). Gating
  // real content behind a client-only mount avoids server/client clock drift
  // producing a hydration mismatch — the cost is one blank frame on first load.
  const mounted = useHasMounted();

  return (
    <div
      className={cn(
        "mx-auto flex h-dvh w-full max-w-[1800px] gap-5 overflow-hidden px-4",
        focusMode
          ? "pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1.25rem)]"
          : "pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+5.5rem)] md:px-6 md:pt-4 md:pb-6"
      )}
    >
      {!focusMode && <Sidebar />}

      <main
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          pathname === "/calendar" ? "overflow-hidden" : "overflow-y-auto"
        )}
      >
        {!focusMode && (
          <>
            <div className="mb-2.5 flex shrink-0 items-center gap-2.5 md:mb-5">
              {/* min-w-0 so the bar yields space to the fixed-width search button
                  instead of pushing it off the right edge on narrow screens. */}
              <div className="min-w-0 flex-1">
                <QuickAddBar />
              </div>
              <button
                type="button"
                onClick={() => setCommandPaletteOpen(true)}
                aria-label="Search"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-ink-faint transition-colors hover:text-ink md:h-[46px] md:w-[46px]"
              >
                <Search className="h-4 w-4" strokeWidth={1.9} />
              </button>
            </div>
            {pathname !== "/settings" && <CategoryChips />}
          </>
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
