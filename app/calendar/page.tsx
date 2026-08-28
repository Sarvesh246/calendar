"use client";

import { startTransition, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { addMonths, addWeeks, format, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useDatebookStore, useCategory } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { applyCategoryFilter } from "@/lib/filters";
import { itemsOnDay, dayLabel, weekDays } from "@/lib/date-utils";
import { MonthView } from "@/components/calendar/month-view";
import { WeekView } from "@/components/calendar/week-view";
import { DaySheet } from "@/components/day-sheet";
import { ItemCard } from "@/components/item-card";
import { EmptyState } from "@/components/empty-state";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Item } from "@/lib/types";

type ViewMode = "month" | "week";

export default function CalendarPage() {
  const allItems = useDatebookStore((s) => s.items);
  const weekStartsOn = useDatebookStore((s) => s.settings.weekStartsOn);
  const categoryFilter = useUIStore((s) => s.categoryFilter);
  const items = useMemo(() => applyCategoryFilter(allItems, categoryFilter), [allItems, categoryFilter]);

  const [mode, setMode] = useState<ViewMode>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const days = useMemo(() => weekDays(anchor, weekStartsOn), [anchor, weekStartsOn]);
  const selectedItems = useMemo(
    () => (selectedDate ? itemsOnDay(items, selectedDate) : []),
    [items, selectedDate]
  );

  // The month/week swap and month/week navigation re-render the whole grid.
  // Marking them as transitions keeps the tapped control responsive (no INP
  // stall) and lets React render the new view without blocking paint.
  function step(dir: 1 | -1) {
    startTransition(() => {
      setSelectedDate(null);
      setAnchor((a) => (mode === "month" ? addMonths(a, dir) : addWeeks(a, dir)));
    });
  }

  function selectDate(d: Date) {
    startTransition(() => setSelectedDate(d));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 sm:gap-4">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h1 className="font-display text-[22px] italic leading-tight text-ink sm:text-[28px]">
          {mode === "month"
            ? format(anchor, "MMMM yyyy")
            : `Week of ${format(startOfWeek(anchor, { weekStartsOn }), "MMM d")}`}
        </h1>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous"
              className="flex h-9 w-9 items-center justify-center rounded-md text-ink-soft hover:bg-surface-sunken hover:text-ink"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => startTransition(() => { setAnchor(new Date()); setSelectedDate(new Date()); })}
              className="h-9 px-2.5 text-[12.5px] font-medium text-ink-soft hover:text-ink"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next"
              className="flex h-9 w-9 items-center justify-center rounded-md text-ink-soft hover:bg-surface-sunken hover:text-ink"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5">
            {(["month", "week"] as ViewMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => startTransition(() => { setMode(m); setSelectedDate(null); })}
                className={cn(
                  "h-9 rounded-md px-3.5 text-[12.5px] font-medium capitalize transition-colors",
                  mode === m ? "bg-accent text-accent-ink" : "text-ink-soft hover:text-ink"
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </header>

      <motion.div
        key={mode}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
        className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row md:gap-4"
      >
        {mode === "month" ? (
          <MonthView
            anchor={anchor}
            items={items}
            selectedDate={selectedDate}
            onSelectDate={selectDate}
            onSwipeMonth={step}
          />
        ) : (
          <WeekView days={days} items={items} onSelectDate={selectDate} />
        )}

        <AnimatePresence>
          {selectedDate && (
            <motion.aside
              key="desktop-day"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
              className="glass hidden min-h-0 w-72 shrink-0 flex-col overflow-hidden rounded-xl p-4 md:flex"
            >
              <p className="mb-3 shrink-0 text-[13px] font-medium text-ink">{dayLabel(selectedDate)}</p>
              {selectedItems.length === 0 ? (
                <EmptyState title="Nothing scheduled." sub={`Free day on ${format(selectedDate, "MMM d")}.`} />
              ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-y-contain">
                  {selectedItems.map((item) => (
                    <SelectedItemRow key={item.id} item={item} />
                  ))}
                </div>
              )}
            </motion.aside>
          )}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {selectedDate && (
          <DaySheet
            key={selectedDate.toISOString()}
            date={selectedDate}
            items={selectedItems}
            onClose={() => setSelectedDate(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function SelectedItemRow({ item }: { item: Item }) {
  const category = useCategory(item.categoryId);
  return <ItemCard item={item} category={category} />;
}
