"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useDeferredCategoryFilter, useUIStore } from "@/lib/ui-store";
import { applyCategoryFilter } from "@/lib/filters";
import { useCategoriesById } from "@/lib/card-chrome";
import { formatClock, formatTimeRange, weekdayLong, weekdayShort } from "@/lib/class-schedule";
import {
  buildWeeklySchedule,
  formatDuration,
  placeDayBlocks,
  type PlacedBlock,
} from "@/lib/weekly-schedule";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PhoneSchedule } from "@/components/schedule/phone-schedule";
import { cn } from "@/lib/utils";

/** Vertical scale of the timetable. One minute ≈ one pixel reads at a glance
 *  and keeps a normal 8am–6pm week inside a single screen on a laptop. */
const PX_PER_MIN = 1.05;

export default function SchedulePage() {
  const allItems = useDatebookStore((s) => s.items);
  const weekStartsOn = useDatebookStore((s) => s.settings.weekStartsOn);
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const categoryFilter = useDeferredCategoryFilter();
  const openClassSchedule = useUIStore((s) => s.openClassSchedule);
  const categoriesById = useCategoriesById();

  const items = useMemo(
    () => applyCategoryFilter(allItems, categoryFilter),
    [allItems, categoryFilter]
  );

  // Which column to mark. Read once per mount — a timetable is the same all
  // day, and the only thing that moves it is a date change.
  const [today] = useState(() => new Date().getDay());

  const schedule = useMemo(
    () => buildWeeklySchedule(items, new Date(), weekStartsOn),
    [items, weekStartsOn]
  );

  const colorOf = (categoryId?: string) =>
    (categoryId ? categoriesById.get(categoryId)?.color : undefined) ?? "var(--ink-faint)";
  const nameOf = (categoryId?: string) =>
    categoryId ? categoriesById.get(categoryId)?.name : undefined;

  const busiestDay = useMemo(() => {
    let best = { day: -1, minutes: -1 };
    for (const day of schedule.days) {
      const minutes = schedule.blocks
        .filter((b) => b.day === day)
        .reduce((sum, b) => sum + (b.endMin - b.startMin), 0);
      if (minutes > best.minutes) best = { day, minutes };
    }
    return best.day < 0 ? "—" : weekdayShort(best.day);
  }, [schedule]);

  const empty = schedule.blocks.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold tracking-tight text-ink">Schedule</h1>
          <p className="mt-1 max-w-[52ch] text-[13px] text-ink-soft">
            Your week as it actually repeats — every class, lab and standing commitment in one
            place.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => openClassSchedule()}>
          <CalendarClock className="h-3.5 w-3.5" strokeWidth={2} />
          Class times
        </Button>
      </header>

      {empty ? (
        <EmptyState
          title="No repeating schedule yet."
          sub="Add your class times — or import a calendar — and anything that lands on the same day each week will lay itself out here."
          action={
            <Button variant="primary" size="sm" onClick={() => openClassSchedule()}>
              Add class times
            </Button>
          }
        />
      ) : (
        <>
          <SummaryStrip
            meetings={schedule.meetingsPerWeek}
            minutes={schedule.minutesPerWeek}
            dayCount={schedule.days.length}
            earliestMin={schedule.earliestMin}
            latestMin={schedule.latestMin}
            busiest={busiestDay}
            clock24h={clock24h}
          />

          <TimetableGrid
            schedule={schedule}
            today={today}
            clock24h={clock24h}
            colorOf={colorOf}
          />

          {/* Phones get a day at a time on a real timeline; from `md` up the
              grid above already answers the same question better. */}
          <PhoneSchedule
            schedule={schedule}
            weekStartsOn={weekStartsOn}
            clock24h={clock24h}
            colorOf={colorOf}
            nameOf={nameOf}
          />

          <p className="px-0.5 text-[12px] leading-relaxed text-ink-faint">
            Built from anything weekly — class times you entered and repeating events from
            imported calendars. One-off events stay on the calendar.
          </p>
        </>
      )}
    </div>
  );
}

function SummaryStrip({
  meetings,
  minutes,
  dayCount,
  earliestMin,
  latestMin,
  busiest,
  clock24h,
}: {
  meetings: number;
  minutes: number;
  dayCount: number;
  earliestMin: number;
  latestMin: number;
  busiest: string;
  clock24h: boolean;
}) {
  const stats: { label: string; value: string; wide?: boolean }[] = [
    { label: "Meetings", value: `${meetings}/week` },
    { label: "In class", value: formatDuration(minutes) },
    { label: "Days on campus", value: `${dayCount}` },
    { label: "Busiest day", value: busiest },
    {
      // Two columns on a phone, where an 18-character range would otherwise
      // be cut off by the tile it is the whole point of.
      wide: true,
      label: "Your window",
      value: `${formatClock(Math.floor(earliestMin / 60), earliestMin % 60, clock24h)} – ${formatClock(
        Math.floor(latestMin / 60),
        latestMin % 60,
        clock24h
      )}`,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className={cn(
            "rounded-xl border border-line bg-surface px-3.5 py-3",
            stat.wide && "col-span-2 sm:col-span-1"
          )}
        >
          <p className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            {stat.label}
          </p>
          <p className="mt-1 truncate text-[15px] font-semibold tabular-nums text-ink">
            {stat.value}
          </p>
        </div>
      ))}
    </div>
  );
}

/** The timetable proper — days across, hours down. Desktop and tablet. */
function TimetableGrid({
  schedule,
  today,
  clock24h,
  colorOf,
}: {
  schedule: ReturnType<typeof buildWeeklySchedule>;
  today: number;
  clock24h: boolean;
  colorOf: (categoryId?: string) => string;
}) {
  // Snapped to the hours the week actually touches — an empty band above the
  // first class is just scrolling you have to do before you can read anything.
  const gridStart = Math.max(0, Math.floor(schedule.earliestMin / 60) * 60);
  const gridEnd = Math.min(24 * 60, Math.ceil(schedule.latestMin / 60) * 60);
  const span = Math.max(60, gridEnd - gridStart);
  const height = span * PX_PER_MIN;
  const hours = Array.from({ length: span / 60 + 1 }, (_, i) => gridStart + i * 60);

  const byDay = useMemo(() => {
    const map = new Map<number, PlacedBlock[]>();
    for (const day of schedule.days) {
      map.set(
        day,
        placeDayBlocks(schedule.blocks.filter((b) => b.day === day))
      );
    }
    return map;
  }, [schedule]);

  const nowMin = useNowMinutes();
  const showNow = schedule.days.includes(today) && nowMin >= gridStart && nowMin <= gridEnd;

  const columns = `4.25rem repeat(${schedule.days.length}, minmax(0, 1fr))`;

  return (
    <div className="hidden overflow-hidden rounded-xl border border-line bg-surface md:block">
      <div
        className="grid border-b border-line bg-surface-sunken/40"
        style={{ gridTemplateColumns: columns }}
      >
        <div aria-hidden />
        {schedule.days.map((day) => (
          <div
            key={day}
            className={cn(
              "border-l border-line px-2 py-2 text-center",
              today === day && "bg-accent-soft"
            )}
          >
            <p
              className={cn(
                "text-[12.5px] font-semibold",
                today === day ? "text-accent" : "text-ink"
              )}
            >
              {weekdayLong(day)}
            </p>
            <p className="text-[11px] text-ink-faint">
              {byDay.get(day)?.length ?? 0} · {formatDuration(
                (byDay.get(day) ?? []).reduce((sum, b) => sum + (b.endMin - b.startMin), 0)
              )}
            </p>
          </div>
        ))}
      </div>

      <div className="overflow-y-auto" style={{ maxHeight: "min(38rem, calc(100dvh - 22rem))" }}>
        <div className="grid" style={{ gridTemplateColumns: columns, height }}>
          <div className="relative">
            {hours.map((minute) => (
              <span
                key={minute}
                className="absolute right-2 -translate-y-1/2 whitespace-nowrap text-[10.5px] tabular-nums text-ink-faint"
                style={{ top: (minute - gridStart) * PX_PER_MIN }}
              >
                {minute === gridStart ? "" : formatClock(minute / 60, 0, clock24h)}
              </span>
            ))}
          </div>

          {schedule.days.map((day) => (
            <div
              key={day}
              className={cn(
                "relative border-l border-line",
                today === day && "bg-accent-soft/40"
              )}
            >
              {/* Hour rules as one gradient rather than an element per hour —
                  the grid stays a handful of nodes however long the day runs. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(to bottom, var(--line) 0 1px, transparent 1px var(--hour-step))",
                  ["--hour-step" as string]: `${60 * PX_PER_MIN}px`,
                }}
              />
              {showNow && today === day && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 z-[2] border-t border-accent"
                  style={{ top: (nowMin - gridStart) * PX_PER_MIN }}
                >
                  <span className="absolute -left-[3px] -top-[4px] h-[7px] w-[7px] rounded-full bg-accent" />
                </div>
              )}
              {(byDay.get(day) ?? []).map((block) => {
                const minutes = block.endMin - block.startMin;
                const color = colorOf(block.categoryId);
                return (
                  <div
                    key={block.key}
                    className="absolute p-[3px]"
                    style={{
                      top: (block.startMin - gridStart) * PX_PER_MIN,
                      height: minutes * PX_PER_MIN,
                      left: `${(block.lane / block.lanes) * 100}%`,
                      width: `${100 / block.lanes}%`,
                    }}
                  >
                    <div
                      className="cal-chip flex h-full flex-col overflow-hidden rounded-lg px-2 py-1"
                      style={{ ["--cat" as string]: color }}
                      title={`${block.title} · ${formatRange(block, clock24h)}${
                        block.location ? ` · ${block.location}` : ""
                      }`}
                    >
                      <p className="truncate text-[12px] font-semibold leading-tight text-ink">
                        {block.title}
                      </p>
                      {minutes >= 40 && (
                        <p className="truncate text-[10.5px] tabular-nums text-ink-soft">
                          {formatRange(block, clock24h)}
                        </p>
                      )}
                      {minutes >= 70 && block.location && (
                        <p className="mt-auto truncate text-[10.5px] text-ink-faint">
                          {block.location}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Minutes past midnight, re-read once a minute — enough for a "now" rule. */
function useNowMinutes(): number {
  const [minutes, setMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = new Date();
      setMinutes(now.getHours() * 60 + now.getMinutes());
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);
  return minutes;
}

function formatRange(
  block: { startMin: number; endMin: number },
  clock24h: boolean
): string {
  return formatTimeRange(
    Math.floor(block.startMin / 60),
    block.startMin % 60,
    Math.floor(block.endMin / 60),
    block.endMin % 60,
    clock24h
  );
}
