"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { addMonths, addWeeks, format, parseISO, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { applyItemFilters } from "@/lib/filters";
import { dayKey, itemsOnDay, weekDays } from "@/lib/date-utils";
import { MonthView } from "@/components/calendar/month-view";
import { WeekView } from "@/components/calendar/week-view";
import { DayAgenda } from "@/components/day-agenda";
import { Button } from "@/components/ui/button";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";

type ViewMode = "month" | "week";

export default function CalendarPage() {
  const allItems = useDatebookStore((s) => s.items);
  const weekStartsOn = useDatebookStore((s) => s.settings.weekStartsOn);
  const hideCompleted = useDatebookStore((s) => s.settings.hideCompleted);
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

  function step(dir: 1 | -1) {
    startTransition(() => {
      setAnchor((a) => (mode === "month" ? addMonths(a, dir) : addWeeks(a, dir)));
    });
  }

  function selectDate(d: Date) {
    startTransition(() => setSelectedDate(d));
  }

  function addToSelected() {
    setQuickAddDateKey(dayKey(selectedDate));
    setQuickAddPrefill("");
    setQuickAddOpen(true);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 sm:gap-4">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-ink sm:text-[26px]">
          {mode === "month"
            ? format(anchor, "MMMM yyyy")
            : `Week of ${format(startOfWeek(anchor, { weekStartsOn }), "MMM d")}`}
        </h1>

        <div className="flex items-center gap-2">
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
              onClick={() =>
                startTransition(() => {
                  const t = new Date();
                  setAnchor(t);
                  setSelectedDate(t);
                })
              }
              className="h-9 px-2.5 text-[13px] font-medium text-ink-soft hover:text-ink"
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
                onClick={() => startTransition(() => setMode(m))}
                className={cn(
                  "h-9 rounded-md px-3.5 text-[13px] font-medium capitalize transition-colors",
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
        className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row"
      >
        <div
          className={cn(
            "min-h-0",
            mode === "month"
              ? "h-[min(52vh,440px)] lg:h-full lg:min-h-[28rem] lg:flex-1"
              : "lg:h-full lg:flex-1"
          )}
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
          )}
        </div>

        {mode === "month" && (
          <DayAgenda
            date={selectedDate}
            items={selectedItems}
            onAdd={addToSelected}
            className="lg:hidden"
          />
        )}

        <aside className="glass hidden min-h-0 w-80 shrink-0 flex-col overflow-hidden rounded-xl p-4 lg:flex">
          <DayAgenda date={selectedDate} items={selectedItems} onAdd={addToSelected} />
        </aside>
      </motion.div>
    </div>
  );
}
