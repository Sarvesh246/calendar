"use client";

import { useEffect, useState } from "react";
import { differenceInMinutes, formatDistanceToNowStrict } from "date-fns";
import { formatTime } from "@/lib/date-utils";
import { useDatebookStore } from "@/lib/store";
import type { Category, Item } from "@/lib/types";

export function UpNextCard({ item, category }: { item: Item; category: Category | undefined }) {
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const showLocation = useDatebookStore((s) => s.settings.showLocation);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const color = category?.color ?? "#8a8a93";
  const start = new Date(item.at);
  const end = item.endAt ? new Date(item.endAt) : null;
  const started = now >= start;
  const totalMin = end ? differenceInMinutes(end, start) : 0;
  const progress = totalMin > 0 ? Math.min(1, Math.max(0, differenceInMinutes(now, start) / totalMin)) : 0;

  return (
    <div className="rounded-lg border border-line bg-surface p-5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
        {started && <span aria-hidden className="live-dot h-1.5 w-1.5 rounded-full bg-accent" />}
        {started ? "Happening now" : "Up next"}
      </p>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <h3 className="line-clamp-2 break-words text-[17px] font-semibold text-ink">{item.title}</h3>
        <span className="shrink-0 text-[12px] tabular-nums text-ink-soft" suppressHydrationWarning>
          {!started && formatDistanceToNowStrict(start, { addSuffix: false })}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-soft">
        <span className="tabular-nums font-medium text-ink-soft">
          {item.allDay ? "All day" : formatTime(item.at, clock24h)}
          {!item.allDay && end && ` – ${formatTime(item.endAt!, clock24h)}`}
        </span>
        {showLocation && item.location && (
          <span className="truncate">{item.location}</span>
        )}
        {category && (
          <span className="flex items-center gap-1.5 text-[12px] text-ink-faint">
            <span className="h-2 w-2 rounded-full" style={{ background: color }} />
            {category.name}
          </span>
        )}
      </div>
      {!item.allDay && end && (
        <div className="mt-4 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          {started && progress < 1 && (
            <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
              {Math.max(1, differenceInMinutes(end, now))}m left
            </span>
          )}
        </div>
      )}
    </div>
  );
}
