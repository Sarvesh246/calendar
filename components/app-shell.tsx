"use client";

import { Search } from "lucide-react";
import { Sidebar } from "./sidebar";
import { QuickAddBar } from "./quick-add-bar";
import { CommandPalette } from "./command-palette";
import { AIDrawer } from "./ai-drawer";
import { useUIStore } from "@/lib/ui-store";
import { useHasMounted } from "@/lib/use-has-mounted";

export function AppShell({ children }: { children: React.ReactNode }) {
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const focusMode = useUIStore((s) => s.focusMode);

  // Several views render "live" time-relative text (countdowns, "today"). Gating
  // real content behind a client-only mount avoids server/client clock drift
  // producing a hydration mismatch — the cost is one blank frame on first load.
  const mounted = useHasMounted();

  return (
    <div className="mx-auto flex w-full max-w-[1800px] gap-5 px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] md:px-6 md:pb-6">
      {!focusMode && <Sidebar />}

      <main className="min-w-0 flex-1">
        {!focusMode && (
          <div className="mb-5 flex items-center gap-2.5">
            <div className="flex-1">
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
        </>
      )}
    </div>
  );
}
