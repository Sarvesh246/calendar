"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { addMonths, addWeeks, format, parseISO, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { applyItemFilters } from "@/lib/filters";
import { dayKey, itemsOnDay, weekDays } from "@/lib/date-utils";
import { MonthView } from "@/components/calendar/month-view";
import { WeekView } from "@/components/calendar/week-view";
import { DayAgenda } from "@/components/day-agenda";
import { DaySheet } from "@/components/day-sheet";
import { Button } from "@/components/ui/button";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";

type ViewMode = "month" | "week";

/** Direction-aware travel for the header title (vertical) and grid (lateral). */
const titleVariants = {
  enter: (d: number) => ({ opacity: 0, y: d > 0 ? 10 : -10 }),
  center: { opacity: 1, y: 0 },
  exit: (d: number) => ({ opacity: 0, y: d > 0 ? -10 : 10 }),
};

const gridVariants = {
  // A short lateral travel plus a fade: enough to say "the period moved this
  // way" without the grid sliding a full width, which at this size reads as a
  // lurch rather than a page turn.
  enter: (d: number) => ({ opacity: 0, x: d > 0 ? 24 : -24 }),
  center: { opacity: 1, x: 0 },
  exit: (d: number) => ({ opacity: 0, x: d > 0 ? -24 : 24 }),
};

export default function CalendarPage() {
  const allItems = useDatebookStore((s) => s.items);
  const weekStartsOn = useDatebookStore((s) => s.settings.weekStartsOn);
  const hideCompleted = useDatebookStore((s) => s.settings.hideCompleted);
  const mobileDayDetails = useDatebookStore((s) => s.settings.mobileDayDetails);
  const categoryFilter = useUIStore((s) => s.categoryFilter);
  const items = useMemo(
    () => applyItemFilters(allItems, { categoryFilter, hideCompleted }),
    [allItems, categoryFilter, hideCompleted]
  );
  const calendarFocusDate = useUIStore((s) => s.calendarFocusDate);
  const setCalendarFocusDate = useUIStore((s) => s.setCalendarFocusDate);
  const setQuickAddDateKey = useUIStore((s) => s.setQuickAddDateKey);
  const setQuickAddTime = useUIStore((s) => s.setQuickAddTime);
  const setQuickAddPrefill = useUIStore((s) => s.setQuickAddPrefill);
  const setQuickAddOpen = useUIStore((s) => s.setQuickAddOpen);
  const setFocusedItemId = useUIStore((s) => s.setFocusedItemId);
  const updateItem = useDatebookStore((s) => s.updateItem);

  const [mode, setMode] = useState<ViewMode>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [sheetOpen, setSheetOpen] = useState(false);
  // Which way the period last moved, so the grid can leave the way it came.
  const [direction, setDirection] = useState<1 | -1>(1);

  useEffect(() => {
    if (!calendarFocusDate) return;
    const d = parseISO(calendarFocusDate);
    if (Number.isNaN(d.getTime())) {
      setCalendarFocusDate(null);
      return;
    }
    startTransition(() => {
      setAnchor(d);
      setSelectedDate(d);
    });
    setCalendarFocusDate(null);
  }, [calendarFocusDate, setCalendarFocusDate]);

  const days = useMemo(() => weekDays(anchor, weekStartsOn), [anchor, weekStartsOn]);
  const selectedItems = useMemo(
    () => itemsOnDay(items, selectedDate),
    [items, selectedDate]
  );

  function step(dir: 1 | -1, immediate = false) {
    haptic("light");
    setDirection(dir);
    const update = () =>
      setAnchor((a) => (mode === "month" ? addMonths(a, dir) : addWeeks(a, dir)));
    if (immediate) update();
    else startTransition(update);
  }

  function selectDate(d: Date) {
    startTransition(() => setSelectedDate(d));
    if (mobileDayDetails === "sheet") setSheetOpen(true);
  }

  // Keyed by the period on screen, so stepping months swaps one grid for
  // another. Upstream keyed only on `mode`, which meant month navigation
  // replaced the days with no transition at all.
  const periodKey =
    mode === "month"
      ? `m-${format(anchor, "yyyy-MM")}`
      : `w-${format(startOfWeek(anchor, { weekStartsOn }), "yyyy-MM-dd")}`;

  function addToSelected() {
    setQuickAddDateKey(dayKey(selectedDate));
    setQuickAddPrefill("");
    setQuickAddOpen(true);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 sm:gap-4">
      <header className="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <h1 className="flex min-w-0 items-baseline overflow-hidden text-[22px] font-semibold leading-tight tracking-tight text-ink sm:text-[26px]">
          {/* The title travels with the grid rather than swapping a frame early,
              so the header and the days read as one movement. */}
          <AnimatePresence mode="popLayout" initial={false} custom={direction}>
            <motion.span
              key={periodKey}
              custom={direction}
              variants={titleVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
              className="block whitespace-nowrap"
            >
              {mode === "month"
                ? format(anchor, "MMMM yyyy")
                : `Week of ${format(startOfWeek(anchor, { weekStartsOn }), "MMM d")}`}
            </motion.span>
          </AnimatePresence>
        </h1>

        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5">
            <Button
              variant="tertiary"
              size="iconSm"
              onClick={() => step(-1)}
              aria-label="Previous"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <button
              type="button"
              onClick={() => {
                const t = new Date();
                haptic("light");
                setDirection(t >= anchor ? 1 : -1);
                startTransition(() => {
                  setAnchor(t);
                  setSelectedDate(t);
                });
              }}
              className="h-9 rounded-md px-2.5 text-[13px] font-medium text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              Today
            </button>
            <Button
              variant="tertiary"
              size="iconSm"
              onClick={() => step(1)}
              aria-label="Next"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5">
            {(["month", "week"] as ViewMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  if (m === mode) return;
                  haptic("light");
                  startTransition(() => setMode(m));
                }}
                aria-pressed={mode === m}
                className={cn(
                  "press-none relative h-9 rounded-md px-3.5 text-[13px] font-medium capitalize",
                  "transition-colors duration-[var(--motion-standard)]",
                  mode === m ? "text-accent-ink" : "text-ink-soft hover:text-ink"
                )}
              >
                {mode === m && (
                  <motion.span
                    layoutId="calendar-mode-pill"
                    className="absolute inset-0 rounded-md bg-accent"
                    transition={motionTokens.spring}
                  />
                )}
                <span className="relative z-[1]">{m}</span>
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <div
          className={cn(
            "relative min-h-0 w-full",
            mode === "month"
              ? "h-[clamp(24rem,72dvh,100%)] lg:h-full lg:min-h-[28rem] lg:flex-1"
              : "lg:h-full lg:flex-1"
          )}
        >
          {mode === "month" ? (
            <div className="absolute inset-0 flex min-h-0 flex-col">
              <MonthView
                anchor={anchor}
                items={items}
                selectedDate={selectedDate}
                onSelectDate={selectDate}
                onSwipeMonth={(dir) => step(dir, true)}
              />
            </div>
          ) : (
            <AnimatePresence mode="popLayout" initial={false} custom={direction}>
              <motion.div
                key={`week-${periodKey}`}
                custom={direction}
                variants={gridVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
                className="absolute inset-0 flex min-h-0 flex-col"
              >
                <WeekView
                  days={days}
                  items={items}
                  onSelectDate={selectDate}
                  onSelectItem={(item, day) => {
                    setFocusedItemId(item.id);
                    selectDate(day);
                  }}
                  onCreateAt={(day, hour, minute) => {
                    setQuickAddDateKey(dayKey(day));
                    setQuickAddTime({ hour, minute });
                    setQuickAddPrefill("");
                    setQuickAddOpen(true);
                  }}
                  onReschedule={(id, at, endAt) =>
                    updateItem(id, endAt ? { at, endAt } : { at })
                  }
                />
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        {mobileDayDetails === "inline" && (
          <section className="min-h-0 shrink-0 rounded-xl border border-line bg-surface p-4 lg:hidden">
            <DayAgenda date={selectedDate} items={selectedItems} onAdd={addToSelected} />
          </section>
        )}

        {/* `flex-1 min-h-0` on the panel itself, or its list has no height to
            scroll within: the aside clips (overflow-hidden) and anything past
            the fold — or an expanded card — simply couldn't be reached. */}
        <aside className="bg-surface border border-line hidden min-h-0 w-[21rem] shrink-0 flex-col overflow-hidden rounded-xl p-4 lg:flex xl:w-[23rem]">
          <DayAgenda
            className="min-h-0 flex-1"
            date={selectedDate}
            items={selectedItems}
            onAdd={addToSelected}
          />
        </aside>
      </div>

      <AnimatePresence>
        {sheetOpen && mode === "month" && mobileDayDetails === "sheet" && (
          <DaySheet
            key={dayKey(selectedDate)}
            date={selectedDate}
            items={selectedItems}
            onClose={() => setSheetOpen(false)}
            onAdd={addToSelected}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
