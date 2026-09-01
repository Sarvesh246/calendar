"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterButton } from "@/components/filter-sheet";
import { useUIStore } from "@/lib/ui-store";
import { cn } from "@/lib/utils";

/** Fixed top-right controls — page content scrolls underneath. */
export function MobileHeaderActions() {
  const pathname = usePathname();
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const onSettings = pathname === "/settings";

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-30 md:hidden",
        "pt-[calc(env(safe-area-inset-top)+0.5rem)]"
      )}
    >
      <div className="flex justify-end gap-2 px-3">
        <Button
          variant="secondary"
          size="icon"
          onClick={() => setCommandPaletteOpen(true)}
          aria-label="Search"
          className="pointer-events-auto h-10 w-10 rounded-full border border-line bg-surface"
        >
          <Search className="h-4 w-4" strokeWidth={1.9} />
        </Button>
        {!onSettings && (
          <FilterButton className="pointer-events-auto h-10 w-10 rounded-full border border-line bg-surface" />
        )}
        <Link
          href="/settings"
          aria-label="Settings"
          className={cn(
            "pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full border",
            "border-line bg-surface text-ink-soft transition-colors hover:text-ink",
            onSettings && "border-accent/50 bg-accent-soft text-accent"
          )}
        >
          <Settings className="h-4 w-4" strokeWidth={1.9} />
        </Link>
      </div>
    </div>
  );
}
