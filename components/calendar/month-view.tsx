"use client";

import { isSameDay, isToday, format } from "date-fns";
import { useDatebookStore } from "@/lib/store";
import { monthGrid, itemsOnDay } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import type { Item } from "@/lib/types";

const WEEKDAY_LABELS_SUN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LABELS_MON = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
  const grid = monthGrid(anchor, weekStartsOn);
  const labels = weekStartsOn === 0 ? WEEKDAY_LABELS_SUN : WEEKDAY_LABELS_MON;

  return (
    <div className="rounded-xl border border-line bg-surface p-2 shadow-[var(--shadow-sm)] sm:p-3">
      <div className="grid grid-cols-7 gap-1.5 px-1 pb-2">
        {labels.map((l) => (
          <div key={l} className="text-center text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            {l}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {grid.map(({ date, inMonth }) => {
          const dayItems = itemsOnDay(items, date);
          const today = isToday(date);
          const selected = selectedDate && isSameDay(date, selectedDate);
          const visible = dayItems.slice(0, 3);
          const overflow = dayItems.length - visible.length;

          return (
            <button
              key={date.toISOString()}
              onClick={() => onSelectDate(date)}
              style={
                today
                  ? ({
                      background:
                        "radial-gradient(140% 140% at 20% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 70%)",
                    } as React.CSSProperties)
                  : undefined
              }
              className={cn(
                "flex min-h-[76px] flex-col items-start gap-1 rounded-lg border p-1.5 text-left transition-all sm:min-h-[92px] sm:p-2",
                today ? "border-accent/40" : "border-transparent hover:border-line",
                selected && "ring-2 ring-accent ring-offset-0",
                !inMonth && "opacity-40"
              )}
            >
              <span
                className={cn(
                  "text-[12px] font-medium tabular-nums",
                  today ? "text-accent" : "text-ink-soft"
                )}
              >
                {format(date, "d")}
              </span>
              <div className="flex w-full flex-col gap-0.5">
                {visible.map((item) => {
                  const category = categories.find((c) => c.id === item.categoryId);
                  return (
                    <span
                      key={item.id}
                      className="flex items-center gap-1 truncate text-[10.5px] text-ink-soft"
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: category?.color ?? "#8a8a94" }}
                      />
                      <span className="truncate">{item.title}</span>
                    </span>
                  );
                })}
                {overflow > 0 && (
                  <span className="text-[10.5px] text-ink-faint">+{overflow} more</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
