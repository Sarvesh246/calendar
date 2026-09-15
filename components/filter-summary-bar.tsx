"use client";

import { startTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SlidersHorizontal, X } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { summariseFilters } from "@/lib/filter-summary";
import { useAllViews } from "@/components/saved-views";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens, prefersReducedMotion } from "@/lib/motion";

/**
 * The filter you forgot you set.
 *
 * Until now the only sign that a class filter was on was an 8px dot on More,
 * and "hide completed" had no sign at all — it lives in the Filter sheet (and
 * as a Settings preference). Both silently delete things from every screen at
 * once, which is how "my assignment disappeared" happens.
 *
 * So: a compact line that names what is on ("2 classes · Incomplete") and can
 * turn it off in one tap, on every tab, whenever a filter is active — and
 * nothing at all when none is. Phones only; the desktop sidebar already shows
 * the selected classes as a list you can't miss. Tapping the line opens the
 * same Filter sheet as More → Filters.
 */
export function FilterSummaryBar() {
  const categories = useDatebookStore((s) => s.categories);
  const hideCompleted = useDatebookStore((s) => s.settings.hideCompleted);
  const updateSettings = useDatebookStore((s) => s.updateSettings);
  const categoryFilter = useUIStore((s) => s.categoryFilter);
  const clearAllFilters = useUIStore((s) => s.clearAllFilters);
  const setFilterOpen = useUIStore((s) => s.setFilterOpen);
  const activeViewId = useUIStore((s) => s.activeViewId);
  const views = useAllViews();

  // A saved view is a filter like any other — arguably the strongest one, since
  // it silently sets status, kind and range as well as classes. Leaving it out
  // of the bar would be the exact failure this bar exists to prevent.
  const summary = summariseFilters(
    categories,
    categoryFilter,
    hideCompleted,
    views.find((v) => v.id === activeViewId)?.name
  );
  // `MotionConfig reducedMotion="user"` drops transforms and keeps opacity, but
  // an animating *height* is neither — it is the page reflowing under you, which
  // is exactly what someone with reduced motion asked not to happen.
  const reduced = prefersReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {summary.active && (
        <motion.div
          key="filter-summary"
          // Height rather than opacity: the bar takes space from the page, so
          // it has to give that space back as it goes or the content jumps.
          initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          animate={reduced ? { opacity: 1 } : { height: "auto", opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={reduced ? motionTokens.tweenStandard : motionTokens.springLayout}
          className="shrink-0 overflow-hidden md:hidden"
        >
          <div className="mb-2.5 flex items-center gap-2 rounded-full border border-accent/35 bg-accent-soft px-1 py-1">
            <button
              type="button"
              onClick={() => {
                haptic("light");
                setFilterOpen(true);
              }}
              className="press-none flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-full px-2.5 text-left"
              aria-label={`${summary.announcement}. Change filters`}
            >
              <SlidersHorizontal
                className="h-3.5 w-3.5 shrink-0 text-accent"
                strokeWidth={2}
                aria-hidden
              />
              <span className="min-w-0 truncate text-[12.5px] font-medium text-accent">
                {summary.label}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                haptic("light");
                clearAllFilters();
                if (hideCompleted) {
                  startTransition(() => updateSettings({ hideCompleted: false }));
                }
              }}
              className="press-none flex h-9 min-w-11 shrink-0 items-center justify-center gap-1 rounded-full px-2.5 text-[12.5px] font-semibold text-accent"
              aria-label="Clear all filters"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
              Reset
            </button>
          </div>
          {/* Announced once per change rather than on every re-render of the
              lists underneath, which is what a live region on the list itself
              would have done. */}
          <p role="status" className="sr-only">
            {summary.announcement}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
