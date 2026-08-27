"use client";

import { useMemo } from "react";
import { format, isToday, differenceInMinutes, startOfDay } from "date-fns";
import { useDatebookStore } from "@/lib/store";
import { groupItemsByDay, dayKey } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import type { Item } from "@/lib/types";

const START_HOUR = 7;
const END_HOUR = 22;
const HOUR_HEIGHT = 52;
const NO_ITEMS: Item[] = [];

export function WeekView({ days, items }: { days: Date[]; items: Item[] }) {
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const categories = useDatebookStore((s) => s.categories);
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);

  const byDay = useMemo(() => groupItemsByDay(items), [items]);
  const colorOf = useMemo(() => {
    const m = new Map(categories.map((c) => [c.id, c.color] as const));
    return (categoryId: string) => m.get(categoryId) ?? "#8a8a94";
  }, [categories]);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-sm)] sm:h-[calc(100dvh-11.5rem)] sm:overflow-y-auto">
      <div className="sticky top-0 z-10 grid grid-cols-[48px_repeat(7,1fr)] border-b border-line bg-surface">
        <div />
        {days.map((day) => (
          <div key={day.toISOString()} className={cn("border-l border-line px-2 py-2 text-center", isToday(day) && "bg-accent-soft")}>
            <p className="text-[10.5px] font-medium uppercase tracking-wider text-ink-faint">{format(day, "EEE")}</p>
            <p className={cn("text-[15px] font-medium tabular-nums", isToday(day) ? "text-accent" : "text-ink")}>
              {format(day, "d")}
            </p>
          </div>
        ))}
      </div>

      {/* all-day / assignment rail */}
      <div className="grid grid-cols-[48px_repeat(7,1fr)] border-b border-line">
        <div className="py-1.5 text-right text-[10px] text-ink-faint" />
        {days.map((day) => {
          const dayAssignments = (byDay.get(dayKey(day)) ?? NO_ITEMS).filter((i) => i.type !== "event");
          return (
            <div key={day.toISOString()} className="flex flex-col gap-1 border-l border-line p-1">
              {/* Narrow screens: 7 columns leave no room for legible text, so just
                  show colored dots — one per item, matching each item's category color. */}
              <div className="flex flex-wrap gap-1 sm:hidden">
                {dayAssignments.slice(0, 4).map((item) => {
                  return (
                    <span
                      key={item.id}
                      aria-hidden
                      className="h-[5px] w-[5px] shrink-0 rounded-full"
                      style={{ background: colorOf(item.categoryId) }}
                    />
                  );
                })}
                {dayAssignments.length > 4 && (
                  <span className="text-[9px] font-medium leading-none text-ink-faint">
                    +{dayAssignments.length - 4}
                  </span>
                )}
              </div>
              <div className="hidden flex-col gap-1 sm:flex">
                {dayAssignments.slice(0, 2).map((item) => {
                  const color = colorOf(item.categoryId);
                  return (
                    <span
                      key={item.id}
                      className="truncate rounded px-1.5 py-0.5 text-[10px] font-medium"
                      style={{
                        background: `color-mix(in srgb, ${color} 14%, var(--surface))`,
                        color,
                      }}
                    >
                      {item.title}
                    </span>
                  );
                })}
              </div>
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
          const dayEvents = (byDay.get(dayKey(day)) ?? NO_ITEMS).filter((i) => i.type === "event");
          return (
            <div key={day.toISOString()} className="relative border-l border-line">
              {hours.map((h) => (
                <div key={h} style={{ height: HOUR_HEIGHT }} className="border-b border-line" />
              ))}
              {dayEvents.map((item) => {
                const start = new Date(item.at);
                const dayStart = startOfDay(start);
                const startMin = differenceInMinutes(start, dayStart) - START_HOUR * 60;
                const durationMin = item.endAt ? differenceInMinutes(new Date(item.endAt), start) : 45;
                const top = Math.max(0, (startMin / 60) * HOUR_HEIGHT);
                const height = Math.max(22, (durationMin / 60) * HOUR_HEIGHT - 2);
                const color = colorOf(item.categoryId);
                return (
                  <div
                    key={item.id}
                    style={{
                      top,
                      height,
                      background: `color-mix(in srgb, ${color} 14%, var(--surface))`,
                      borderLeft: `2.5px solid ${color}`,
                    }}
                    className="absolute left-1 right-1 overflow-hidden rounded-md px-1.5 py-1 text-[10.5px] leading-tight"
                  >
                    <p className="truncate font-medium" style={{ color }}>
                      {item.title}
                    </p>
                    {height > 32 && (
                      <p className="truncate text-ink-faint">{format(start, clock24h ? "HH:mm" : "h:mm a")}</p>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
