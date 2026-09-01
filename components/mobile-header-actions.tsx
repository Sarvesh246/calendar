"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterButton } from "@/components/filter-sheet";
import { useUIStore } from "@/lib/ui-store";
import { cn } from "@/lib/utils";

/** Fixed top-right controls — page content scrolls underneath when scrolling. */
export function MobileHeaderActions() {
  const pathname = usePathname();
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const onSettings = pathname === "/settings";

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-30 md:hidden",
        "pt-[calc(env(safe-area-inset-top)+0.875rem)]"
      )}
    >
      <div className="flex justify-end px-3">
        <div className="pointer-events-auto isolate flex items-center gap-1 rounded-full border border-line bg-surface p-1">
          <Button
            variant="tertiary"
            size="icon"
            onClick={() => setCommandPaletteOpen(true)}
            aria-label="Search"
            className="h-9 w-9 rounded-full bg-surface"
          >
            <Search className="h-4 w-4" strokeWidth={1.9} />
          </Button>
          {!onSettings && (
            <FilterButton className="h-9 w-9 rounded-full border-0 bg-surface shadow-none" />
          )}
          <Link
            href="/settings"
            aria-label="Settings"
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface text-ink-soft transition-colors hover:text-ink",
              onSettings && "bg-accent-soft text-accent"
            )}
          >
            <Settings className="h-4 w-4" strokeWidth={1.9} />
          </Link>
        </div>
      </div>
    </div>
  );
}
