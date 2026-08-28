"use client";

import { useMemo } from "react";
import { isSameDay, isToday, format } from "date-fns";
import { useDatebookStore } from "@/lib/store";
import { monthGrid, groupItemsByDay, dayKey } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import type { Item } from "@/lib/types";

const WEEKDAY_LABELS_SUN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LABELS_MON = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const NO_ITEMS: Item[] = [];

export function MonthView({
  anchor,
  items,
  selectedDate,
  onSelectDate,
}: {
  anchor: Date;
  items: Item[];
  selectedDate: Date | null;
  onSelectDate: (date: Date) => void;
}) {
  const weekStartsOn = useDatebookStore((s) => s.settings.weekStartsOn);
  const categories = useDatebookStore((s) => s.categories);
  const grid = useMemo(() => monthGrid(anchor, weekStartsOn), [anchor, weekStartsOn]);
  const byDay = useMemo(() => groupItemsByDay(items), [items]);
  const colorOf = useMemo(() => {
    const m = new Map(categories.map((c) => [c.id, c.color] as const));
    return (categoryId: string) => m.get(categoryId) ?? "#8a8a94";
  }, [categories]);
  const labels = weekStartsOn === 0 ? WEEKDAY_LABELS_SUN : WEEKDAY_LABELS_MON;
  const weeks = grid.length / 7;

  return (
    <div className="flex flex-col rounded-xl border border-line bg-surface p-2 shadow-[var(--shadow-sm)] sm:h-[calc(100dvh-11.5rem)] sm:p-3">
      <div className="grid grid-cols-7 gap-1.5 px-1 pb-2">
        {labels.map((l) => (
          <div key={l} className="text-center text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            {l}
          </div>
        ))}
      </div>
      {/* The 92px row floor + scroll only applies from `sm` up, where the card
          is height-capped and short viewports would otherwise crush the rows
          until an event chip is clipped. On mobile the grid shows dots only and
          has no height cap, so the floor is left at 0 to keep cells compact. */}
      <div
        className="grid flex-1 grid-cols-7 gap-1.5 [--month-row-min:0px] sm:min-h-0 sm:overflow-y-auto sm:[--month-row-min:92px]"
        style={{ gridTemplateRows: `repeat(${weeks}, minmax(var(--month-row-min), 1fr))` }}
      >
        {grid.map(({ date, inMonth }) => {
          const dayItems = byDay.get(dayKey(date)) ?? NO_ITEMS;
          const today = isToday(date);
          const selected = selectedDate && isSameDay(date, selectedDate);
          const visible = dayItems.slice(0, 3);
          const overflow = dayItems.length - visible.length;
          const visibleDots = dayItems.slice(0, 4);
          const dotOverflow = dayItems.length - visibleDots.length;

          return (
            <button
              key={date.toISOString()}
              onClick={() => onSelectDate(date)}
              aria-pressed={selected ?? false}
              aria-label={
                `${format(date, "EEEE, MMMM d")}` +
                (today ? ", today" : "") +
                (dayItems.length
                  ? `, ${dayItems.length} item${dayItems.length === 1 ? "" : "s"}`
                  : ", nothing scheduled")
              }
              style={
                today
                  ? ({
                      background:
                        "radial-gradient(140% 140% at 20% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 70%)",
                    } as React.CSSProperties)
                  : undefined
              }
              className={cn(
                "flex min-h-[68px] flex-col items-stretch gap-1 overflow-hidden rounded-lg border p-1.5 text-left transition-all sm:min-h-0 sm:p-2",
                today ? "border-accent/40" : "border-transparent hover:border-line",
                // inset ring: an outset one is clipped by the grid's sm overflow
                selected && "ring-2 ring-inset ring-accent",
                !inMonth && "opacity-70"
              )}
            >
              <span
                className={cn(
                  "shrink-0 text-[12px] font-semibold tabular-nums",
                  today ? "text-accent" : inMonth ? "text-ink" : "text-ink-faint"
                )}
              >
                {format(date, "d")}
              </span>
              {/* Narrow screens: cells are too tight for legible text, so just show
                  colored dots — one per item, matching each item's category color. */}
              <div className="flex flex-wrap content-start gap-1 sm:hidden">
                {visibleDots.map((item) => {
                  const color = colorOf(item.categoryId);
                  return (
                    <span
                      key={item.id}
                      aria-hidden
                      className="h-[5px] w-[5px] shrink-0 rounded-full"
                      style={{ background: color }}
                    />
                  );
                })}
                {dotOverflow > 0 && (
                  <span className="text-[9px] font-medium leading-none text-ink-faint">+{dotOverflow}</span>
                )}
              </div>

              <div className="hidden min-h-0 w-full flex-1 flex-col gap-1 overflow-hidden sm:flex">
                {visible.map((item) => {
                  const color = colorOf(item.categoryId);
                  return (
                    <span
                      key={item.id}
                      title={item.title}
                      className="shrink-0 truncate rounded px-1.5 py-[2px] text-[11px] font-medium leading-tight"
                      style={{
                        background: `color-mix(in srgb, ${color} 18%, var(--surface))`,
                        color: `color-mix(in srgb, ${color} 82%, var(--ink))`,
                      }}
                    >
                      {item.title}
                    </span>
                  );
                })}
                {overflow > 0 && (
                  <span className="px-1 text-[10.5px] font-medium text-ink-soft">+{overflow} more</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
