"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function FilterButton({ className }: { className?: string }) {
  const filter = useUIStore((s) => s.categoryFilter);
  const setFilterOpen = useUIStore((s) => s.setFilterOpen);
  const active = Boolean(filter?.length);

  return (
    <Button
      variant="secondary"
      size="icon"
      onClick={() => setFilterOpen(true)}
      aria-label={active ? `Filter, ${filter!.length} selected` : "Filter by class"}
      className={cn("relative", className)}
    >
      <SlidersHorizontal className="h-4 w-4" strokeWidth={1.9} />
      {active && (
        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" />
      )}
    </Button>
  );
}

export function FilterSheet() {
  const open = useUIStore((s) => s.filterOpen);
  const setOpen = useUIStore((s) => s.setFilterOpen);
  const categories = useDatebookStore((s) => s.categories);
  const filter = useUIStore((s) => s.categoryFilter);
  const toggle = useUIStore((s) => s.toggleCategoryFilter);
  const clear = useUIStore((s) => s.clearCategoryFilter);
  const visible = categories.filter((c) => !c.archived);
  useLockBodyScroll(open);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button
        type="button"
        aria-label="Close filter"
        className="overlay-scrim absolute inset-0"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Filter by class"
        className="glass absolute inset-x-0 bottom-0 rounded-t-2xl px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3"
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[15px] font-semibold text-ink">Classes</p>
          <Button variant="tertiary" size="iconSm" onClick={() => setOpen(false)} aria-label="Close">
            <X className="h-4 w-4" strokeWidth={2} />
          </Button>
        </div>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => {
              clear();
              setOpen(false);
            }}
            className={cn(
              "flex min-h-11 items-center rounded-lg px-3 text-left text-[14px] font-medium",
              !filter ? "bg-accent-soft text-ink" : "text-ink-soft hover:bg-surface-sunken"
            )}
          >
            All
          </button>
          {visible.map((cat) => {
            const active = filter?.includes(cat.id) ?? false;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => toggle(cat.id)}
                className={cn(
                  "flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-left text-[14px]",
                  active ? "bg-surface-sunken text-ink" : "text-ink-soft hover:bg-surface-sunken"
                )}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cat.color }} />
                {cat.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
