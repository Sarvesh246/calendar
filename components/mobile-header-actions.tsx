"use client";

import { Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterButton } from "@/components/filter-sheet";
import { useUIStore } from "@/lib/ui-store";


/** Floating top-right glass controls. The page stays continuous; content
 *  scrolls under this cluster. No full-width header strip. */
export function MobileHeaderActions({ pathname }: { pathname: string }) {
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const setAIDrawerOpen = useUIStore((s) => s.setAIDrawerOpen);
  const onSettings = pathname === "/settings";

  return (
    <div className="viewport-pinned-top pointer-events-none fixed inset-x-0 top-0 z-30 md:hidden">
      {/* Sits a little below the status bar / notch rather than tucked against
          it, so the cluster's blur never bleeds into the system chrome. */}
      <div className="pt-[calc(env(safe-area-inset-top)+1.375rem)]">
        <div className="flex justify-end px-3">
          <div className="mobile-header-cluster pointer-events-auto flex items-center gap-0.5 p-0.5">
            <Button
              variant="tertiary"
              size="icon"
              onClick={() => setAIDrawerOpen(true)}
              aria-label="Ask the assistant"
              className="h-11 w-11 rounded-full bg-transparent text-accent hover:bg-surface-sunken"
            >
              <Sparkles className="h-4 w-4" strokeWidth={1.9} />
            </Button>
            <Button
              variant="tertiary"
              size="icon"
              onClick={() => setCommandPaletteOpen(true)}
              aria-label="Search"
              className="h-11 w-11 rounded-full bg-transparent hover:bg-surface-sunken"
            >
              <Search className="h-4 w-4" strokeWidth={1.9} />
            </Button>
            {!onSettings && (
              <FilterButton className="h-11 w-11 rounded-full border-0 bg-transparent shadow-none hover:bg-surface-sunken" />
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
