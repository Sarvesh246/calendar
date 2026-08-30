"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format, isToday, isSameDay, differenceInMinutes, startOfDay } from "date-fns";
import { useDatebookStore, useCategory } from "@/lib/store";
import { groupItemsByDay, dayKey, dayLabel } from "@/lib/date-utils";
import { ItemCard } from "@/components/item-card";
import { cn } from "@/lib/utils";
import { assignOverlapColumns } from "@/lib/event-layout";
import type { Item } from "@/lib/types";

const DEFAULT_START_HOUR = 7;
const DEFAULT_END_HOUR = 22;
const HOUR_HEIGHT = 52;
const NO_ITEMS: Item[] = [];

const clampHour = (h: number) => Math.max(0, Math.min(24, h));

/** Timed events outside 07:00–22:00 used to be clamped onto the first row or
 *  scrolled off the bottom with no affordance. Widen the window so it always
 *  covers every timed event visible this week. */
function hourWindow(days: Date[], byDay: Map<string, Item[]>) {
  let start = DEFAULT_START_HOUR;
  let end = DEFAULT_END_HOUR;
  for (const day of days) {
    for (const it of byDay.get(dayKey(day)) ?? NO_ITEMS) {
      if (it.type !== "event" || it.allDay) continue;
      const s = new Date(it.at);
      start = Math.min(start, s.getHours());
      const e = it.endAt ? new Date(it.endAt) : null;
      const endHour = e && isSameDay(e, s)
        ? e.getHours() + (e.getMinutes() > 0 ? 1 : 0)
        : e && e > s
        ? 24
        : s.getHours() + 1;
      end = Math.max(end, endHour);
    }
  }
  return { startHour: clampHour(start), endHour: clampHour(Math.max(end, start + 1)) };
}

export function WeekView({
  days,
  items,
  onSelectDate,
  onSelectItem,
  onCreateAt,
  onReschedule,
}: {
  days: Date[];
  items: Item[];
  onSelectDate?: (date: Date) => void;
  onSelectItem?: (item: Item, day: Date) => void;
  onCreateAt?: (day: Date, hour: number, minute: number) => void;
  onReschedule?: (id: string, at: string, endAt?: string) => void;
}) {
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const categories = useDatebookStore((s) => s.categories);

  const byDay = useMemo(() => groupItemsByDay(items), [items]);
  const { startHour, endHour } = useMemo(() => hourWindow(days, byDay), [days, byDay]);
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);
  const colorOf = useMemo(() => {
    const m = new Map(categories.map((c) => [c.id, c.color] as const));
    return (categoryId: string) => m.get(categoryId) ?? "#8a8a94";
  }, [categories]);

  return (
    <>
      <MobileWeekPager days={days} byDay={byDay} />

      <div className="hidden min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-sm)] md:flex md:overflow-y-auto">
        <div className="sticky top-0 z-10 grid grid-cols-[48px_repeat(7,1fr)] border-b border-line bg-surface">
          <div />
          {days.map((day) => (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onSelectDate?.(day)}
              className={cn("border-l border-line px-2 py-2 text-center", isToday(day) && "bg-accent-soft")}
            >
              <p className="text-[10.5px] font-medium uppercase tracking-wider text-ink-faint">{format(day, "EEE")}</p>
              <p className={cn("text-[15px] font-medium tabular-nums", isToday(day) ? "text-accent" : "text-ink")}>
                {format(day, "d")}
              </p>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-[48px_repeat(7,1fr)] border-b border-line">
          <div className="py-1.5 text-right text-[10px] text-ink-faint" />
          {days.map((day) => {
            const dayAssignments = (byDay.get(dayKey(day)) ?? NO_ITEMS).filter(
              (i) => i.type !== "event" || i.allDay
            );
            const visible = dayAssignments.slice(0, 2);
            const overflow = dayAssignments.length - visible.length;
            const hiddenTitles = dayAssignments
              .slice(2)
              .map((i) => i.title)
              .join(", ");
            return (
              <div key={day.toISOString()} className="flex flex-col gap-1 border-l border-line p-1">
                {visible.map((item) => {
                  const color = colorOf(item.categoryId);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        if (onSelectItem) onSelectItem(item, day);
                        else onSelectDate?.(day);
                      }}
                      className={cn(
                        "cal-chip truncate px-1.5 py-0.5 text-left text-[10px] font-medium",
                        item.type !== "event" && "cal-chip-task",
                        item.status === "done" && "opacity-45",
                        item.type !== "event" && item.status !== "done" && "cal-chip-task"
                      )}
                      style={{ "--cat": color } as React.CSSProperties}
                    >
                      {item.title}
                    </button>
                  );
                })}
                {overflow > 0 && (
                  <button
                    type="button"
                    onClick={() => onSelectDate?.(day)}
                    title={hiddenTitles}
                    className="truncate rounded px-1.5 py-0.5 text-left text-[10px] font-medium text-ink-soft"
                  >
                    +{overflow}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="relative grid grid-cols-[48px_repeat(7,1fr)]">
          <div>
            {hours.map((h) => (
              <div key={h} style={{ height: HOUR_HEIGHT }} className="border-b border-line pr-2 text-right text-[10px] text-ink-faint">
                {format(new Date(0, 0, 0, h), clock24h ? "HH:00" : "h a")}
              </div>
            ))}
          </div>
          {days.map((day) => {
            const dayEvents = (byDay.get(dayKey(day)) ?? NO_ITEMS).filter(
              (i) => i.type === "event" && !i.allDay
            );
            return (
              <div key={day.toISOString()} className="relative border-l border-line">
                {hours.map((h) => (
                  <button
                    key={h}
                    type="button"
                    aria-label={`Add at ${h}:00`}
                    onClick={() => onCreateAt?.(day, h, 0)}
                    style={{ height: HOUR_HEIGHT }}
                    className="block w-full border-b border-line hover:bg-accent-soft/40"
                  />
                ))}
                {assignOverlapColumns(
                  dayEvents.map((item) => {
                    const start = new Date(item.at);
                    const dayStart = startOfDay(start);
                    const startMin = differenceInMinutes(start, dayStart) - startHour * 60;
                    const durationMin = item.endAt ? differenceInMinutes(new Date(item.endAt), start) : 45;
                    return {
                      item,
                      startMin,
                      endMin: startMin + Math.max(20, durationMin),
                      durationMin,
                    };
                  })
                ).map(({ item, startMin, durationMin, col, colCount }) => {
                  const start = new Date(item.at);
                  const top = Math.max(0, (startMin / 60) * HOUR_HEIGHT);
                  const height = Math.max(22, (durationMin / 60) * HOUR_HEIGHT - 2);
                  const color = colorOf(item.categoryId);
                  const widthPct = 100 / colCount;
                  return (
                    <TimedBlock
                      key={item.id}
                      item={item}
                      day={day}
                      top={top}
                      height={height}
                      color={color}
                      widthPct={widthPct}
                      col={col}
                      clock24h={clock24h}
                      startHour={startHour}
                      onSelect={() => {
                        if (onSelectItem) onSelectItem(item, day);
                        else onSelectDate?.(day);
                      }}
                      onReschedule={onReschedule}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function TimedBlock({
  item,
  top,
  height,
  color,
  widthPct,
  col,
  clock24h,
  onSelect,
  onReschedule,
}: {
  item: Item;
  day: Date;
  top: number;
  height: number;
  color: string;
  widthPct: number;
  col: number;
  clock24h: boolean;
  startHour: number;
  onSelect: () => void;
  onReschedule?: (id: string, at: string, endAt?: string) => void;
}) {
  const start = new Date(item.at);
  const drag = useRef<{ y: number; moved: boolean } | null>(null);
  const [dy, setDy] = useState(0);

  function snapMinutes(px: number) {
    const raw = (px / HOUR_HEIGHT) * 60;
    return Math.round(raw / 15) * 15;
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!onReschedule) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, moved: false };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const delta = e.clientY - drag.current.y;
    if (Math.abs(delta) > 6) drag.current.moved = true;
    setDy(delta);
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    const minutes = snapMinutes(dy);
    setDy(0);
    if (!d) return;
    if (!d.moved) {
      onSelect();
      return;
    }
    if (!onReschedule || minutes === 0) return;
    const nextStart = new Date(start.getTime() + minutes * 60_000);
    const nextEnd = item.endAt
      ? new Date(new Date(item.endAt).getTime() + minutes * 60_000).toISOString()
      : undefined;
    onReschedule(item.id, nextStart.toISOString(), nextEnd);
  }

  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null;
        setDy(0);
      }}
      onClick={(e) => {
        if (drag.current?.moved) e.preventDefault();
      }}
      style={{
        top: top + dy,
        height,
        left: `calc(${col * widthPct}% + 4px)`,
        width: `calc(${widthPct}% - 8px)`,
        background: `color-mix(in srgb, ${color} 14%, var(--surface))`,
        borderLeft: `2.5px solid ${color}`,
      }}
      className="absolute z-[1] cursor-grab overflow-hidden rounded-md px-1.5 py-1 text-left text-[10.5px] leading-tight active:cursor-grabbing"
    >
      <p className="truncate font-medium" style={{ color }}>
        {item.title}
      </p>
      {height > 32 && (
        <p className="truncate text-ink-faint">{format(start, clock24h ? "HH:mm" : "h:mm a")}</p>
      )}
    </button>
  );
}

function MobileWeekPager({
  days,
  byDay,
}: {
  days: Date[];
  byDay: Map<string, Item[]>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(() => Math.max(0, days.findIndex((d) => isToday(d))));

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const idx = days.findIndex((d) => isToday(d));
    if (idx < 0) return;
    el.scrollTo({ left: el.clientWidth * idx, behavior: "instant" });
    setPage(idx);
  }, [days]);

  return (
    <div className="md:hidden">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          const next = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          setPage((p) => (p === next ? p : next));
        }}
        className="-mx-2 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] md:-mx-4 [&::-webkit-scrollbar]:hidden"
      >
        {days.map((day) => {
          const dayItems = byDay.get(dayKey(day)) ?? NO_ITEMS;
          const label = dayLabel(day);
          return (
            <section
              key={day.toISOString()}
              className="w-full shrink-0 snap-start px-2 md:px-4"
            >
              <div className="mb-3 flex items-baseline justify-between">
                <p className="text-[15px] font-semibold text-ink">{label}</p>
                <p className="text-[12.5px] text-ink-faint">{format(day, "MMM d")}</p>
              </div>
              {dayItems.length === 0 ? (
                <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-ink-faint">
                  Nothing scheduled.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {dayItems.map((item) => (
                    <WeekDayItem key={item.id} item={item} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
      <div className="mt-3 flex justify-center gap-1.5">
        {days.map((day, i) => (
          <span
            key={day.toISOString()}
            aria-hidden
            className={cn(
              "h-1.5 rounded-full transition-all",
              i === page ? "w-4 bg-accent" : "w-1.5 bg-line-strong"
            )}
          />
        ))}
      </div>
    </div>
  );
}

function WeekDayItem({ item }: { item: Item }) {
  const category = useCategory(item.categoryId);
  return <ItemCard item={item} category={category} />;
}
