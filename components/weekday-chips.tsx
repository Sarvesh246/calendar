"use client";

import { weekdayShort } from "@/lib/class-schedule";
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
    <div className="flex flex-wrap gap-1.5">
      {[0, 1, 2, 3, 4, 5, 6].map((d) => {
        const on = value.includes(d);
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            onClick={() => {
              haptic("light");
              onChange(on ? value.filter((x) => x !== d) : [...value, d].sort((a, b) => a - b));
            }}
            className={cn(
              "flex h-10 min-w-10 items-center justify-center rounded-full px-2.5 text-[12.5px] font-medium transition-colors",
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
