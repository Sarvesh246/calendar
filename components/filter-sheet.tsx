"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, SlidersHorizontal, X } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";
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
      onClick={() => {
        haptic("light");
        setFilterOpen(true);
      }}
      aria-label={active ? `Filter, ${filter!.length} selected` : "Filter by class"}
      className={cn("relative", className)}
    >
      <SlidersHorizontal className="h-4 w-4" strokeWidth={1.9} />
      {/* The "filters are on" dot springs in rather than blinking, so the state
          change registers even though it's a 8px mark in the corner. */}
      <AnimatePresence initial={false}>
        {active && (
          <motion.span
            key="dot"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={motionTokens.springSnappy}
            className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent ring-2 ring-surface"
          />
        )}
      </AnimatePresence>
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

  return (
    // This is a bottom sheet, so it moves like the day sheet does: thrown up
    // from the bottom edge on a spring, and quicker on the way out. Before, it
    // was an unconditional early return — it simply blinked into existence.
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <motion.button
            type="button"
            aria-label="Close filter"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
            className="overlay-scrim absolute inset-0"
            onClick={() => setOpen(false)}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Filter by class"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%", transition: { duration: motionTokens.exit, ease: motionTokens.easeIn } }}
            transition={motionTokens.springGentle}
            className="glass absolute inset-x-0 bottom-0 rounded-t-2xl px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3"
          >
            <span
              aria-hidden
              className="mx-auto mb-2 block h-1 w-10 rounded-full bg-line-strong opacity-75"
            />
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[15px] font-semibold text-ink">Classes</p>
              <Button
                variant="tertiary"
                size="iconSm"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </Button>
            </div>
            <div className="flex flex-col gap-1">
              <FilterRow
                selected={!filter}
                onSelect={() => {
                  haptic("light");
                  clear();
                  setOpen(false);
                }}
              >
                All classes
              </FilterRow>
              {visible.map((cat) => {
                const active = filter?.includes(cat.id) ?? false;
                return (
                  <FilterRow
                    key={cat.id}
                    selected={active}
                    onSelect={() => {
                      haptic("light");
                      toggle(cat.id);
                    }}
                    dot={cat.color}
                  >
                    {cat.name}
                  </FilterRow>
                );
              })}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/**
 * A row in the filter sheet. Selection used to be carried by a background tint
 * alone, which is easy to miss on a glass sheet — every row now ends in a tick
 * that springs in, so you can see what's on without comparing shades.
 */
function FilterRow({
  selected,
  onSelect,
  dot,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  dot?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "press-none flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-left text-[14px]",
        "transition-colors duration-[var(--motion-standard)]",
        selected ? "bg-accent-soft text-ink" : "text-ink-soft active:bg-surface-sunken"
      )}
    >
      {dot && (
        <motion.span
          initial={false}
          animate={{ scale: selected ? 1.25 : 1 }}
          transition={motionTokens.springSnappy}
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: dot }}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <motion.span
        aria-hidden
        initial={false}
        animate={{ scale: selected ? 1 : 0, opacity: selected ? 1 : 0 }}
        transition={motionTokens.springSnappy}
        className="flex h-4 w-4 shrink-0 items-center justify-center"
      >
        <Check className="h-4 w-4 text-accent" strokeWidth={2.5} />
      </motion.span>
    </button>
  );
}
