"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { MapPin } from "lucide-react";
import { formatClock, formatTimeRange, weekdayLong, weekdayShort } from "@/lib/class-schedule";
import {
  formatDuration,
  placeDayBlocks,
  weekdayOrder,
  type ScheduleBlock,
  type WeeklySchedule,
} from "@/lib/weekly-schedule";
import { EmptyState } from "@/components/empty-state";
import { motion as motionTokens } from "@/lib/motion";
import { haptic } from "@/lib/haptic";
import { patchViewState, readViewState } from "@/lib/view-state";
import { cn } from "@/lib/utils";

/**
 * The weekly schedule, asked the question a phone actually asks it.
 *
 * The desktop timetable answers "what does my week look like" — seven columns,
 * shape at a glance. Stacking all seven days as a list on a phone answered a
 * question nobody had: you scroll past Monday, Tuesday and Wednesday to find
 * out where you need to be on Thursday, and the time column is a pair of
 * numbers rather than anything you can feel the gaps in.
 *
 * A phone asks "where do I need to be next". So: one day at a time, on a real
 * proportional timeline where a two-hour gap looks like a two-hour gap, with a
 * week strip above it that keeps the whole week's shape one tap away and shows
 * which days are heavy before you get there.
 */

/** Vertical scale. Tighter than the desktop grid — a phone is taller than wide. */
const PX_PER_MIN = 0.92;
/** Never draw a block so short its title has nowhere to go. */
const MIN_BLOCK_PX = 44;
/** The hour rail. Wide enough for "12:00 PM" on one line — at 2.9rem it wrapped
 *  to two, and a time that reads as two lines stops reading as a time. */
const RAIL = "3.9rem";

export function PhoneSchedule({
  schedule,
  weekStartsOn,
  clock24h,
  colorOf,
  nameOf,
}: {
  schedule: WeeklySchedule;
  weekStartsOn: 0 | 1;
  clock24h: boolean;
  colorOf: (categoryId?: string) => string;
  nameOf: (categoryId?: string) => string | undefined;
}) {
  const today = useTodayWeekday();
  const order = useMemo(() => weekdayOrder(weekStartsOn), [weekStartsOn]);

  const byDay = useMemo(() => {
    const map = new Map<number, ScheduleBlock[]>();
    for (const block of schedule.blocks) {
      const list = map.get(block.day);
      if (list) list.push(block);
      else map.set(block.day, [block]);
    }
    return map;
  }, [schedule.blocks]);

  // Land on a day worth looking at: the one you were last on, else today, else
  // the next day this week that actually has something on it. Opening the
  // schedule on an empty Sunday tells you nothing.
  const [selected, setSelected] = useState<number>(() => {
    const remembered = readViewState().scheduleDay;
    if (remembered !== undefined) return remembered;
    return -1;
  });

  const resolved = useMemo(() => {
    if (selected >= 0) return selected;
    if (byDay.has(today)) return today;
    const fromToday = [...order.slice(order.indexOf(today)), ...order];
    return fromToday.find((d) => byDay.has(d)) ?? today;
    // `order.indexOf(today)` is -1 only if today is somehow not 0–6.
  }, [selected, today, byDay, order]);

  useEffect(() => {
    patchViewState({ scheduleDay: resolved });
  }, [resolved]);

  const blocks = byDay.get(resolved) ?? [];

  return (
    <div className="flex flex-col gap-3 md:hidden">
      <WeekStrip
        order={order}
        byDay={byDay}
        today={today}
        selected={resolved}
        onSelect={(day) => {
          haptic("light");
          setSelected(day);
        }}
      />
      <DayTimeline
        day={resolved}
        blocks={blocks}
        isToday={resolved === today}
        clock24h={clock24h}
        colorOf={colorOf}
        nameOf={nameOf}
      />
    </div>
  );
}

/**
 * Seven tap targets that also carry the week's shape: a load bar under each
 * day, so "Thursday is the heavy one" is readable without opening Thursday.
 */
function WeekStrip({
  order,
  byDay,
  today,
  selected,
  onSelect,
}: {
  order: number[];
  byDay: Map<number, ScheduleBlock[]>;
  today: number;
  selected: number;
  onSelect: (day: number) => void;
}) {
  const load = useMemo(() => {
    const minutes = new Map<number, number>();
    let busiest = 0;
    for (const day of order) {
      const total = (byDay.get(day) ?? []).reduce((sum, b) => sum + (b.endMin - b.startMin), 0);
      minutes.set(day, total);
      busiest = Math.max(busiest, total);
    }
    return { minutes, busiest };
  }, [order, byDay]);

  return (
    <div
      role="tablist"
      aria-label="Day of the week"
      className="flex items-stretch gap-1 rounded-xl border border-line bg-surface p-1"
    >
      {order.map((day) => {
        const blocks = byDay.get(day) ?? [];
        const minutes = load.minutes.get(day) ?? 0;
        const isSelected = day === selected;
        const fill = load.busiest > 0 ? Math.max(0.14, minutes / load.busiest) : 0;
        return (
          <button
            key={day}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => onSelect(day)}
            // Spelled out because the visible label is a single letter, which a
            // screen reader would otherwise read as "T" twice a week.
            aria-label={
              `${weekdayLong(day)}${day === today ? ", today" : ""}, ` +
              (blocks.length === 0
                ? "nothing scheduled"
                : `${blocks.length} meeting${blocks.length === 1 ? "" : "s"}, ${formatDuration(minutes)}`)
            }
            className="press-none relative flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-0.5 py-1.5"
          >
            {isSelected && (
              <motion.span
                layoutId="phone-schedule-day"
                aria-hidden
                transition={motionTokens.springSnappy}
                className="absolute inset-0 rounded-lg bg-accent-soft ring-1 ring-accent/45"
              />
            )}
            <span
              aria-hidden
              className={cn(
                "relative z-[1] text-[12.5px] font-semibold tabular-nums",
                isSelected ? "text-accent" : day === today ? "text-ink" : "text-ink-soft"
              )}
            >
              {weekdayShort(day).slice(0, 1)}
            </span>
            <span
              aria-hidden
              className="relative z-[1] h-1 w-full overflow-hidden rounded-full bg-surface-sunken"
            >
              {minutes > 0 && (
                <span
                  className={cn(
                    "block h-full rounded-full",
                    isSelected ? "bg-accent" : "bg-ink-faint/55"
                  )}
                  style={{ width: `${Math.round(fill * 100)}%` }}
                />
              )}
            </span>
            {day === today && (
              <span
                aria-hidden
                className={cn(
                  "relative z-[1] h-1 w-1 rounded-full",
                  isSelected ? "bg-accent" : "bg-ink-faint"
                )}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One day, to scale. The gaps between classes are the information a list of
 * start times throws away — a 25-minute dash across campus and a two-hour hole
 * look identical in a list and nothing alike here.
 */
function DayTimeline({
  day,
  blocks,
  isToday,
  clock24h,
  colorOf,
  nameOf,
}: {
  day: number;
  blocks: ScheduleBlock[];
  isToday: boolean;
  clock24h: boolean;
  colorOf: (categoryId?: string) => string;
  nameOf: (categoryId?: string) => string | undefined;
}) {
  const nowMin = useNowMinutes(isToday);
  const placed = useMemo(() => placeDayBlocks(blocks), [blocks]);

  const totalMinutes = blocks.reduce((sum, b) => sum + (b.endMin - b.startMin), 0);

  if (blocks.length === 0) {
    return (
      <EmptyState
        title={`Nothing on ${weekdayLong(day)}.`}
        sub="No classes or standing commitments land on this day."
        compact
      />
    );
  }

  // Snapped to the hours this day touches, with an hour of air below so a
  // late class isn't flush against the bottom edge.
  const earliest = Math.min(...blocks.map((b) => b.startMin));
  const latest = Math.max(...blocks.map((b) => b.endMin));
  const gridStart = Math.max(0, Math.floor(earliest / 60) * 60);
  const gridEnd = Math.min(24 * 60, Math.ceil(latest / 60) * 60);
  const span = Math.max(60, gridEnd - gridStart);
  const height = span * PX_PER_MIN;
  const hours = Array.from({ length: Math.floor(span / 60) + 1 }, (_, i) => gridStart + i * 60);
  const showNow = isToday && nowMin >= gridStart && nowMin <= gridEnd;

  return (
    <section
      aria-label={`${weekdayLong(day)} timeline`}
      className="rounded-xl border border-line bg-surface p-3"
    >
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-ink">
          {weekdayLong(day)}
          {isToday && (
            <span className="ml-2 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-ink">
              Today
            </span>
          )}
        </h2>
        <p className="shrink-0 text-[11.5px] tabular-nums text-ink-faint">
          {blocks.length} · {formatDuration(totalMinutes)}
        </p>
      </header>

      <div className="relative" style={{ height }}>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0"
          style={{
            left: RAIL,
            backgroundImage:
              "repeating-linear-gradient(to bottom, var(--line) 0 1px, transparent 1px var(--hour-step))",
            ["--hour-step" as string]: `${60 * PX_PER_MIN}px`,
          }}
        />
        {hours.map((minute) => (
          <span
            key={minute}
            aria-hidden
            className="absolute left-0 -translate-y-1/2 whitespace-nowrap pr-2 text-right text-[10.5px] tabular-nums text-ink-faint"
            style={{ top: (minute - gridStart) * PX_PER_MIN, width: RAIL }}
          >
            {formatClock(Math.floor(minute / 60), 0, clock24h)}
          </span>
        ))}

        {showNow && (
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 z-[3] border-t border-accent"
            style={{ left: RAIL, top: (nowMin - gridStart) * PX_PER_MIN }}
          >
            <span className="absolute -left-[3px] -top-[4px] h-[7px] w-[7px] rounded-full bg-accent" />
          </div>
        )}

        <ul className="contents">
          {placed.map((block) => {
            const minutes = block.endMin - block.startMin;
            const color = colorOf(block.categoryId);
            const raw = nameOf(block.categoryId);
            const category =
              raw && !block.title.toLowerCase().startsWith(raw.toLowerCase()) ? raw : undefined;
            const boxHeight = Math.max(MIN_BLOCK_PX, minutes * PX_PER_MIN - 4);
            const laneWidth = 100 / block.lanes;
            return (
              <li
                key={block.key}
                className="absolute"
                style={{
                  top: (block.startMin - gridStart) * PX_PER_MIN,
                  height: boxHeight,
                  left: `calc(${RAIL} + (100% - ${RAIL}) * ${block.lane * laneWidth} / 100)`,
                  width: `calc((100% - ${RAIL}) * ${laneWidth} / 100 - 2px)`,
                }}
              >
                <div
                  className="cat-surface flex h-full flex-col justify-center overflow-hidden rounded-lg px-2 py-1"
                  style={{ ["--cat" as string]: color }}
                >
                  <p className="truncate text-[12.5px] font-semibold leading-tight text-ink">
                    {block.title}
                  </p>
                  <p className="truncate text-[10.5px] tabular-nums text-ink-soft">
                    {formatTimeRange(
                      Math.floor(block.startMin / 60),
                      block.startMin % 60,
                      Math.floor(block.endMin / 60),
                      block.endMin % 60,
                      clock24h
                    )}
                  </p>
                  {boxHeight >= 62 && (category || block.location) && (
                    <p className="flex items-center gap-1 truncate text-[10.5px] text-ink-faint">
                      {block.location && (
                        <MapPin className="h-3 w-3 shrink-0" strokeWidth={1.9} aria-hidden />
                      )}
                      <span className="truncate">{block.location ?? category}</span>
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* The same day as plain text, for anyone whose reading order is the DOM
          rather than the pixels. Absolute positioning carries no sequence. */}
      <p className="sr-only">
        {blocks
          .slice()
          .sort((a, b) => a.startMin - b.startMin)
          .map(
            (b) =>
              `${b.title}, ${formatTimeRange(
                Math.floor(b.startMin / 60),
                b.startMin % 60,
                Math.floor(b.endMin / 60),
                b.endMin % 60,
                clock24h
              )}${b.location ? `, ${b.location}` : ""}`
          )
          .join(". ")}
      </p>
    </section>
  );
}

function useTodayWeekday(): number {
  // Read once per mount, then re-read at midnight-ish. A timetable doesn't
  // change during a session, but a session can outlive a day.
  const [day, setDay] = useState(() => new Date().getDay());
  useEffect(() => {
    const id = window.setInterval(() => setDay(new Date().getDay()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return day;
}

function useNowMinutes(active: boolean): number {
  const [minutes, setMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      const now = new Date();
      setMinutes(now.getHours() * 60 + now.getMinutes());
    }, 60_000);
    return () => window.clearInterval(id);
  }, [active]);
  return minutes;
}
