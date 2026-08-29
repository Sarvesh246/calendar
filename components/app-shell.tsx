"use client";

import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { Sidebar } from "./sidebar";
import { QuickAddBar } from "./quick-add-bar";
import { CommandPalette } from "./command-palette";
import { AIDrawer } from "./ai-drawer";
import { ReminderScheduler } from "./reminder-scheduler";
import { CategoryChips } from "./category-chips";
import { UndoToast } from "./undo-toast";
import { FeedSync } from "./feed-sync";
import { MergeCloudDialog } from "./merge-cloud-dialog";
import { ConflictToast } from "./conflict-toast";
import { useUIStore } from "@/lib/ui-store";
import { useHasMounted } from "@/lib/use-has-mounted";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const focusMode = useUIStore((s) => s.focusMode);
  const pathname = usePathname();
  const fillViewport = pathname === "/calendar";

  useKeyboardInset();

  // Several views render "live" time-relative text (countdowns, "today"). Gating
  // real content behind a client-only mount avoids server/client clock drift
  // producing a hydration mismatch — the cost is one blank frame on first load.
  const mounted = useHasMounted();

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-[1800px] gap-5 px-4",
        // Only the calendar locks to the viewport, so its month grid always
        // fits without page scroll. Every other route scrolls the *document*
        // rather than an inner container. That distinction is the whole ball
        // game on an iOS standalone PWA: an inner scroller lives inside this
        // shell's safe-area padding, so its content is clipped at hard edges
        // well short of the screen — the page reads as a square floating in
        // the middle of the display, with the fixed nav stranded below it.
        // Scrolling the document instead lets content run right up to the
        // screen edges and pass behind the translucent nav.
        fillViewport ? "h-dvh overflow-hidden" : "min-h-dvh",
        focusMode
          ? "pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1.25rem)]"
          : "pt-[calc(env(safe-area-inset-top)+1.25rem)] pb-[calc(env(safe-area-inset-bottom)+5.75rem)] md:min-h-0 md:px-6 md:pt-4 md:pb-6"
      )}
    >
      {!focusMode && <Sidebar />}

      {/* No `overflow-x` here on the scrolling routes: pairing a hidden axis
          with a visible one silently promotes the visible axis to `auto`,
          which would recreate the inner scroller. `body` already carries
          `overflow-x: clip` as the sideways-pan safety net. */}
      <main
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          fillViewport && "min-h-0 overflow-hidden"
        )}
      >
        {!focusMode && (
          <>
            <div className="mb-3 flex shrink-0 items-center gap-2.5 md:mb-5">
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
          <UndoToast />
          <ConflictToast />
          <FeedSync />
          <MergeCloudDialog />
        </>
      )}
    </div>
  );
}
