"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isSameDay, isToday, format } from "date-fns";
import { useDatebookStore } from "@/lib/store";
import { monthGrid, groupItemsByDay, dayKey, isOverdue, openItemsOnDay } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import type { Item } from "@/lib/types";

const WEEKDAY_LABELS_SUN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LABELS_MON = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const NO_ITEMS: Item[] = [];

/** Fixed chip geometry — must match the rendered .cal-chip + gap classes below. */
const CHIP_HEIGHT = 20;
const CHIP_GAP = 4;
const MORE_LINE_HEIGHT = 14;

function chipLabel(item: Item) {
  if (item.allDay) return item.title;
  const d = new Date(item.at);
  if (Number.isNaN(d.getTime())) return item.title;
  const h = d.getHours();
  const hour12 = h % 12 || 12;
  return `${hour12}${h >= 12 ? "p" : "a"} ${item.title}`;
}

function fitCountVertical(
  containerSize: number,
  itemCount: number,
  itemSize: number,
  gap: number,
  moreSize: number
) {
  if (itemCount === 0 || containerSize <= 0) return itemCount;

  const allSize = itemCount * itemSize + Math.max(0, itemCount - 1) * gap;
  if (allSize <= containerSize) return itemCount;

  const forItems = containerSize - moreSize - gap;
  const slot = itemSize + gap;
  return Math.max(0, Math.min(itemCount, Math.floor((forItems + gap) / slot)));
}

function rankForChip(item: Item) {
  if (isOverdue(item)) return 0;
  if (item.type !== "event" && item.status === "done") return 2;
  return 1;
}

function DayCellChips({
  items,
  colorOf,
}: {
  items: Item[];
  colorOf: (categoryId: string) => string;
}) {
  const density = useDatebookStore((s) => s.settings.density);
  const ref = useRef<HTMLDivElement>(null);
  const [fitCount, setFitCount] = useState(() => Math.min(3, items.length));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      setFitCount(fitCountVertical(el.clientHeight, items.length, CHIP_HEIGHT, CHIP_GAP, MORE_LINE_HEIGHT));
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items.length, density]);

  const ranked = useMemo(
    () => [...items].sort((a, b) => rankForChip(a) - rankForChip(b)),
    [items]
  );
  const visible = ranked.slice(0, fitCount);
  const hiddenOpen = openItemsOnDay(ranked.slice(fitCount)).length;
  const hiddenTitles = ranked
    .slice(fitCount)
    .map((i) => i.title)
    .join(", ");

  return (
    <div ref={ref} className="hidden min-h-0 w-full flex-1 flex-col gap-1 overflow-hidden sm:flex">
      {visible.map((item) => {
        const color = colorOf(item.categoryId);
        const done = item.type !== "event" && item.status === "done";
        const task = item.type !== "event";
        return (
          <span
            key={item.id}
            title={item.title}
            className={cn(
              "cal-chip shrink-0 truncate px-1.5 py-[2px] text-[11px] font-medium leading-tight",
              task && "cal-chip-task",
              done && "opacity-45",
              isOverdue(item) && "cal-chip-overdue"
            )}
            style={{ "--cat": color } as React.CSSProperties}
          >
            {chipLabel(item)}
          </span>
        );
      })}
      {hiddenOpen > 0 && (
        <span
          className="shrink-0 px-1 text-[10.5px] font-medium leading-none text-ink-soft"
          title={hiddenTitles}
        >
          +{hiddenOpen}
        </span>
      )}
    </div>
  );
}

function DayCellCount({ items }: { items: Item[] }) {
  const open = openItemsOnDay(items);
  const overdue = items.some(isOverdue);
  if (open.length === 0) return null;
  return (
    <span
      className={cn(
        "shrink-0 text-[10px] font-medium tabular-nums leading-none sm:hidden",
        overdue ? "text-warn" : "text-ink-faint"
      )}
    >
      {open.length}
    </span>
  );
}

export function MonthView({
  anchor,
  items,
  selectedDate,
  onSelectDate,
  onSwipeMonth,
}: {
  anchor: Date;
  items: Item[];
  selectedDate: Date | null;
  onSelectDate: (date: Date) => void;
  onSwipeMonth?: (dir: 1 | -1) => void;
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
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  function onTouchStart(e: React.TouchEvent) {
    swipeStart.current = { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (swipeStart.current == null || !onSwipeMonth) return;
    const dx = e.changedTouches[0].clientX - swipeStart.current.x;
    const dy = e.changedTouches[0].clientY - swipeStart.current.y;
    swipeStart.current = null;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.4) onSwipeMonth(dx < 0 ? 1 : -1);
  }

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface p-1.5 shadow-[var(--shadow-sm)] sm:p-3"
    >
      <div className="grid shrink-0 grid-cols-7 gap-1 px-0.5 pb-1.5 sm:gap-1.5 sm:px-1 sm:pb-2">
        {labels.map((l) => (
          <div key={l} className="text-center text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            {l}
          </div>
        ))}
      </div>
      <div
        className="grid min-h-0 flex-1 grid-cols-7 gap-1 overflow-hidden sm:gap-1.5"
        style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}
      >
        {grid.map(({ date, inMonth }) => {
          const dayItems = byDay.get(dayKey(date)) ?? NO_ITEMS;
          const today = isToday(date);
          const selected = selectedDate && isSameDay(date, selectedDate);

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
                "press-none flex min-h-0 flex-col items-stretch gap-0.5 overflow-hidden rounded-lg border p-1 text-left transition-colors sm:gap-1 sm:p-2",
                today ? "border-accent/40" : "border-transparent hover:border-line",
                selected && "ring-2 ring-inset ring-accent",
                !inMonth && "opacity-70"
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums sm:h-auto sm:w-auto sm:rounded-none sm:p-0 sm:text-[12px]",
                  today
                    ? "bg-accent text-accent-ink sm:bg-transparent sm:text-accent"
                    : inMonth
                      ? "text-ink"
                      : "text-ink-faint"
                )}
              >
                {format(date, "d")}
              </span>
              <DayCellCount items={dayItems} />
              <DayCellChips items={dayItems} colorOf={colorOf} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
