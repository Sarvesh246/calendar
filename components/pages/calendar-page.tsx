"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { addDays, addMonths, addWeeks, format, isSameMonth, parseISO, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore, type CalendarCommand } from "@/lib/ui-store";
import { useFilteredItems } from "@/lib/use-filtered-items";
import { useWorkspacePrefs, type CalendarMode } from "@/lib/workspace-prefs";
import { useAssistantDockable, DOCK_MEDIA_QUERY } from "@/lib/assistant-dock";
import { dayKey, itemsOnDay, weekDays } from "@/lib/date-utils";
import { MonthView } from "@/components/calendar/month-view";
import { WeekView } from "@/components/calendar/week-view";
import { DateJump, type JumpGranularity } from "@/components/calendar/date-jump";
import { WorkspacePane } from "@/components/calendar/workspace-pane";
import { DayAgenda } from "@/components/day-agenda";
import { DaySheet } from "@/components/day-sheet";
import { Button } from "@/components/ui/button";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/lib/use-media-query";

/** From `lg` up the day's details sit in the side pane; below it they need the sheet. */
function belowLg() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;
}

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
  const items = useFilteredItems();
  const weekStartsOn = useDatebookStore((s) => s.settings.weekStartsOn);
  const mobileDayDetails = useDatebookStore((s) => s.settings.mobileDayDetails);
  const shortScreen = useMediaQuery("(max-height: 540px)");
  const wide = useMediaQuery(DOCK_MEDIA_QUERY);
  const useSheet = mobileDayDetails === "sheet" || shortScreen;
  const calendarFocusDate = useUIStore((s) => s.calendarFocusDate);
  const setCalendarFocusDate = useUIStore((s) => s.setCalendarFocusDate);
  const setQuickAddDateKey = useUIStore((s) => s.setQuickAddDateKey);
  const setQuickAddTime = useUIStore((s) => s.setQuickAddTime);
  const setQuickAddDurationMin = useUIStore((s) => s.setQuickAddDurationMin);
  const setQuickAddPrefill = useUIStore((s) => s.setQuickAddPrefill);
  const setQuickAddOpen = useUIStore((s) => s.setQuickAddOpen);
  const setFocusedItemId = useUIStore((s) => s.setFocusedItemId);
  const openInspector = useUIStore((s) => s.openInspector);
  const aiDrawerOpen = useUIStore((s) => s.aiDrawerOpen);
  const dockable = useAssistantDockable();

  // Month or week is a standing preference, not a per-visit choice.
  const mode = useWorkspacePrefs((s) => s.calendarMode);
  const setCalendarMode = useWorkspacePrefs((s) => s.setCalendarMode);
  const paneCollapsed = useWorkspacePrefs((s) => s.paneCollapsed);
  const setPaneCollapsed = useWorkspacePrefs((s) => s.setPaneCollapsed);
  const paneTab = useWorkspacePrefs((s) => s.paneTab);
  const setPaneTab = useWorkspacePrefs((s) => s.setPaneTab);
  const showPane = wide && !paneCollapsed;

  const [anchor, setAnchor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
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
      // Arriving on a day (from search or the agenda) should show it, not just
      // select it behind a closed sheet.
      if (useSheet && belowLg()) setSheetOpen(true);
    });
    setCalendarFocusDate(null);
  }, [calendarFocusDate, setCalendarFocusDate, useSheet]);

  // On a wide calendar the assistant opens in the side pane rather than over
  // the grid, so you can keep clicking dates while you talk.
  useEffect(() => {
    if (!aiDrawerOpen || !dockable) return;
    setPaneTab("assistant");
    setPaneCollapsed(false);
    useUIStore.getState().setAIDrawerOpen(false);
  }, [aiDrawerOpen, dockable, setPaneTab, setPaneCollapsed]);

  const days = useMemo(() => weekDays(anchor, weekStartsOn), [anchor, weekStartsOn]);
  const selectedItems = useMemo(() => itemsOnDay(items, selectedDate), [items, selectedDate]);

  function step(dir: 1 | -1, immediate = false) {
    haptic("light");
    setDirection(dir);
    const update = () => setAnchor((a) => (mode === "month" ? addMonths(a, dir) : addWeeks(a, dir)));
    if (immediate) update();
    else startTransition(update);
  }

  function goToday() {
    const t = new Date();
    haptic("light");
    setDirection(t >= anchor ? 1 : -1);
    startTransition(() => {
      setAnchor(t);
      setSelectedDate(t);
    });
  }

  function changeMode(next: CalendarMode) {
    if (next === mode) return;
    haptic("light");
    startTransition(() => setCalendarMode(next));
  }

  function jumpTo(date: Date, granularity: JumpGranularity) {
    haptic("light");
    setDirection(date >= anchor ? 1 : -1);
    const today = new Date();
    startTransition(() => {
      setAnchor(date);
      setSelectedDate(granularity === "day" || !isSameMonth(today, date) ? date : today);
    });
    if (granularity === "day" && (useSheet || mode === "week") && belowLg()) setSheetOpen(true);
  }

  // Keyboard shortcuts aimed at the calendar arrive as commands. Each is taken
  // once — straight from the store, so the handler always sees this render's
  // state — and one sent while the tab was hidden runs when it's shown.
  const runCommand = useRef<(command: CalendarCommand) => void>(() => {});
  useEffect(() => {
    runCommand.current = (command) => {
      switch (command.kind) {
        case "today":
          goToday();
          break;
        case "mode":
          changeMode(command.mode);
          break;
        case "step":
          step(command.dir);
          break;
        case "toggle-pane":
          if (wide) setPaneCollapsed(!paneCollapsed);
          break;
        case "jump":
          setJumpOpen(true);
          break;
      }
    };
  });
  useEffect(() => {
    const take = () => {
      const command = useUIStore.getState().calendarCommand;
      if (!command) return;
      useUIStore.setState({ calendarCommand: null });
      runCommand.current(command);
    };
    const frame = requestAnimationFrame(take);
    const unsubscribe = useUIStore.subscribe((s, prev) => {
      if (s.calendarCommand && s.calendarCommand !== prev.calendarCommand) take();
    });
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, []);

  function selectDate(d: Date) {
    startTransition(() => setSelectedDate(d));
    if ((useSheet || mode === "week") && belowLg()) setSheetOpen(true);
  }

  // Keyed by the period on screen, so stepping months swaps one grid for
  // another. Upstream keyed only on `mode`, which meant month navigation
  // replaced the days with no transition at all.
  const periodKey =
    mode === "month"
      ? `m-${format(anchor, "yyyy-MM")}`
      : `w-${format(startOfWeek(anchor, { weekStartsOn }), "yyyy-MM-dd")}`;

  function addToSelected() {
    setSheetOpen(false);
    setQuickAddDateKey(dayKey(selectedDate));
    setQuickAddPrefill("");
    setQuickAddOpen(true);
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 sm:gap-4">
      <header className="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <DateJump anchor={anchor} open={jumpOpen} onOpenChange={setJumpOpen} onJump={jumpTo}>
          <h1 className="flex items-baseline overflow-hidden text-[22px] font-semibold leading-tight tracking-tight text-ink sm:text-[26px]">
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
        </DateJump>

        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5">
            <Button
              variant="tertiary"
              size="iconSm"
              onClick={() => step(-1)}
              aria-label={mode === "month" ? "Previous month" : "Previous week"}
              title="Previous (←)"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <button
              type="button"
              onClick={goToday}
              title="Today (T)"
              className="h-9 rounded-md px-2.5 text-[13px] font-medium text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              Today
            </button>
            <Button
              variant="tertiary"
              size="iconSm"
              onClick={() => step(1)}
              aria-label={mode === "month" ? "Next month" : "Next week"}
              title="Next (→)"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5">
              {(["month", "week"] as CalendarMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => changeMode(m)}
                  aria-pressed={mode === m}
                  title={`${m === "month" ? "Month" : "Week"} (${m === "month" ? "M" : "W"})`}
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
            {wide && (
              <Button
                variant="secondary"
                size="iconSm"
                onClick={() => {
                  haptic("light");
                  setPaneCollapsed(!paneCollapsed);
                }}
                aria-label={paneCollapsed ? "Show side panel" : "Hide side panel"}
                aria-pressed={!paneCollapsed}
                title={`${paneCollapsed ? "Show" : "Hide"} side panel (\\)`}
              >
                {paneCollapsed ? (
                  <PanelRightOpen className="h-4 w-4" strokeWidth={1.9} />
                ) : (
                  <PanelRightClose className="h-4 w-4" strokeWidth={1.9} />
                )}
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden lg:flex-row lg:items-stretch">
        <div className="relative min-h-0 w-full min-w-0 flex-1">
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
                    // The day list is where a tapped block opens inline; when
                    // the pane is showing something else (or hidden), the
                    // inspector opens without taking over the pane.
                    if (wide && !(showPane && paneTab === "day")) openInspector(item.id);
                    else setFocusedItemId(item.id);
                    selectDate(day);
                  }}
                  onCreate={(day, startMin, durationMin) => {
                    setQuickAddDateKey(dayKey(day));
                    setQuickAddTime({ hour: Math.floor(startMin / 60), minute: startMin % 60 });
                    setQuickAddDurationMin(durationMin);
                    setQuickAddPrefill("");
                    setQuickAddOpen(true);
                  }}
                />
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        {!useSheet && mode === "month" && (
          <section className="flex h-[32%] min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-surface p-3 lg:hidden">
            <DayAgenda className="flex-1" date={selectedDate} items={selectedItems} onAdd={addToSelected} />
          </section>
        )}

        {/* Bound to the row height so the pane's own list — not the month
            grid — is the thing that scrolls when cards overflow. */}
        {showPane && (
          <WorkspacePane
            selectedDate={selectedDate}
            selectedItems={selectedItems}
            items={items}
            mode={mode}
            onAdd={addToSelected}
            onSwitchToWeek={() => changeMode("week")}
          />
        )}
      </div>

      <AnimatePresence>
        {/* Week mode needs it too: between `md` and `lg` the week grid is
            showing but the side pane isn't. */}
        {sheetOpen && (useSheet || mode === "week") && (
          <DaySheet
            onStep={(dir) => { const next = addDays(selectedDate, dir); setSelectedDate(next); setAnchor(next); }}
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
