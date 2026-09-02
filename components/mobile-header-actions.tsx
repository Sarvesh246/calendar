"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, Settings, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterButton } from "@/components/filter-sheet";
import { useUIStore } from "@/lib/ui-store";
import { cn } from "@/lib/utils";

/** Floating top-right glass controls. The page stays continuous; content
 *  scrolls under this cluster. No full-width header strip. */
export function MobileHeaderActions() {
  const pathname = usePathname();
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const setAIDrawerOpen = useUIStore((s) => s.setAIDrawerOpen);
  const onSettings = pathname === "/settings";

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-30 md:hidden">
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
              className="h-9 w-9 rounded-full bg-transparent text-accent hover:bg-surface-sunken"
            >
              <Sparkles className="h-4 w-4" strokeWidth={1.9} />
            </Button>
            <Button
              variant="tertiary"
              size="icon"
              onClick={() => setCommandPaletteOpen(true)}
              aria-label="Search"
              className="h-9 w-9 rounded-full bg-transparent hover:bg-surface-sunken"
            >
              <Search className="h-4 w-4" strokeWidth={1.9} />
            </Button>
            {!onSettings && (
              <FilterButton className="h-9 w-9 rounded-full border-0 bg-transparent shadow-none hover:bg-surface-sunken" />
            )}
            <Link
              href="/settings"
              aria-label="Settings"
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink",
                onSettings && "bg-surface-sunken text-accent"
              )}
            >
              <Settings className="h-4 w-4" strokeWidth={1.9} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
