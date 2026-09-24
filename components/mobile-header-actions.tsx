"use client";

import { useRouter } from "next/navigation";
import { CalendarClock, Search, Settings, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterButton } from "@/components/filter-sheet";
import { haptic } from "@/lib/haptic";
import { prefersReducedMotion } from "@/lib/motion";
import { useResolvedPathname } from "@/lib/tab-nav";
import { useUIStore } from "@/lib/ui-store";
import { cn } from "@/lib/utils";

/**
 * Floating top-right glass controls. The page stays continuous; content
 * scrolls under this cluster. No full-width header strip.
 *
 * Cluster is Ask · Search · Filters · Schedule · Settings on main tabs.
 * Settings / Schedule rooms drop Ask (Done exits the room) so the cluster
 * stays short and Settings/Schedule stay one tap away — no More drawer.
 * Hiding Ask morphs the capsule width; it does not snap.
 */
export function MobileHeaderActions(_props: { pathname: string }) {
  const router = useRouter();
  const pathname = useResolvedPathname();
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const setAIDrawerOpen = useUIStore((s) => s.setAIDrawerOpen);
  const onSettings = pathname === "/settings";
  const onSchedule = pathname === "/schedule";
  const inRoom = onSettings || onSchedule;
  const reduced = prefersReducedMotion();

  return (
    <div className="mobile-web-header-actions viewport-pinned-top pointer-events-none fixed inset-x-0 top-0 z-30 md:hidden">
      {/* Sits a little below the status bar / notch rather than tucked against
          it, so the cluster's blur never bleeds into the system chrome. */}
      <div className="pt-[calc(env(safe-area-inset-top)+var(--mobile-header-top))]">
        <div className="flex justify-end px-3">
          <div className="mobile-header-cluster pointer-events-auto flex items-center overflow-hidden p-0.5">
            <div
              className={cn(
                "grid min-w-0",
                !reduced && "transition-[grid-template-columns] duration-[var(--motion-emphasis)] ease-[var(--ease-standard)]"
              )}
              style={{ gridTemplateColumns: inRoom ? "0fr" : "1fr" }}
              aria-hidden={inRoom}
            >
              <div className="min-w-0 overflow-hidden">
                <Button
                  variant="tertiary"
                  size="sm"
                  tabIndex={inRoom ? -1 : undefined}
                  onClick={() => setAIDrawerOpen(true)}
                  aria-label="Ask the assistant"
                  className="h-11 gap-1 rounded-full bg-transparent px-2.5 text-accent hover:bg-surface-sunken"
                >
                  <Sparkles className="h-4 w-4" strokeWidth={1.9} />
                  <span className="text-[12.5px] font-semibold tracking-tight">Ask</span>
                </Button>
              </div>
            </div>
            <Button
              variant="tertiary"
              size="icon"
              onClick={() => setCommandPaletteOpen(true)}
              aria-label="Search"
              className="h-11 w-11 rounded-full bg-transparent hover:bg-surface-sunken"
            >
              <Search className="h-4 w-4" strokeWidth={1.9} />
            </Button>
            <FilterButton className="h-11 w-11 rounded-full border-0 bg-transparent shadow-none hover:bg-surface-sunken" />
            <Button
              variant="tertiary"
              size="icon"
              onClick={() => {
                haptic("light");
                if (!onSchedule) router.push("/schedule");
              }}
              aria-label="Schedule"
              aria-current={onSchedule ? "page" : undefined}
              className={cn(
                "h-11 w-11 rounded-full bg-transparent hover:bg-surface-sunken",
                onSchedule && "bg-accent-soft text-accent"
              )}
            >
              <CalendarClock className="h-4 w-4" strokeWidth={1.9} />
            </Button>
            <Button
              variant="tertiary"
              size="icon"
              onClick={() => {
                haptic("light");
                if (!onSettings) router.push("/settings");
              }}
              aria-label="Settings"
              aria-current={onSettings ? "page" : undefined}
              className={cn(
                "h-11 w-11 rounded-full bg-transparent hover:bg-surface-sunken",
                onSettings && "bg-accent-soft text-accent"
              )}
            >
              <Settings className="h-4 w-4" strokeWidth={1.9} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
