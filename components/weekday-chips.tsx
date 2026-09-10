"use client";

import { weekdayLong, weekdayShort } from "@/lib/class-schedule";
import { haptic } from "@/lib/haptic";
import { cn } from "@/lib/utils";

export function WeekdayChips({
  value,
  onChange,
}: {
  value: number[];
  onChange: (days: number[]) => void;
}) {
  return (
    <div className="grid w-full grid-cols-7 gap-1">
      {[0, 1, 2, 3, 4, 5, 6].map((d) => {
        const on = value.includes(d);
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            aria-label={weekdayLong(d)}
            onClick={() => {
              haptic("light");
              onChange(on ? value.filter((x) => x !== d) : [...value, d].sort((a, b) => a - b));
            }}
            className={cn(
              "flex h-9 min-w-0 items-center justify-center rounded-full px-0 text-[11px] font-medium leading-none tracking-tight transition-colors",
              on ? "bg-accent text-accent-ink" : "border border-line bg-surface text-ink-soft hover:text-ink"
            )}
          >
            {weekdayShort(d)}
          </button>
        );
      })}
    </div>
  );
}
