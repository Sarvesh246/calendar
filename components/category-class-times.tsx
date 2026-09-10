"use client";

import { CalendarClock } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { formatMeetingSummary, savedClassMeetings } from "@/lib/class-schedule";
import { haptic } from "@/lib/haptic";
import type { Category } from "@/lib/types";

export function CategoryClassTimesControl({ category }: { category: Category }) {
  const items = useDatebookStore((s) => s.items);
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const openClassSchedule = useUIStore((s) => s.openClassSchedule);
  const meetings = savedClassMeetings(items, category.id);
  const saved = meetings.length > 0;

  return (
    <button
      type="button"
      onClick={() => {
        haptic("light");
        openClassSchedule(category.id);
      }}
      className="flex min-h-11 items-start gap-2 rounded-lg px-0.5 py-1 text-left transition-colors hover:bg-surface-sunken/50"
    >
      <CalendarClock
        className="mt-0.5 h-3.5 w-3.5 shrink-0"
        strokeWidth={1.75}
        style={saved ? { color: category.color } : undefined}
      />
      {saved ? (
        <span className="min-w-0 flex-1">
          {meetings.map((meeting) => (
            <span key={meeting.repeatId} className="block truncate text-[12.5px] font-medium text-ink">
              {formatMeetingSummary(meeting, clock24h)}
            </span>
          ))}
          <span className="mt-0.5 block truncate text-[11.5px] text-ink-faint">
            {meetings.length === 1
              ? `${meetings[0].count} meetings on the calendar · tap to add another`
              : "On the calendar · tap to add another"}
          </span>
        </span>
      ) : (
        <span className="text-[13px] font-medium text-ink-soft">Class times</span>
      )}
    </button>
  );
}

export function ClassTimesRoster() {
  const items = useDatebookStore((s) => s.items);
  const categories = useDatebookStore((s) => s.categories);
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const rows = categories
    .filter((c) => !c.archived)
    .map((cat) => ({ cat, meetings: savedClassMeetings(items, cat.id) }))
    .filter((row) => row.meetings.length > 0);
  if (rows.length === 0) return null;

  return (
    <ul className="mt-3 flex flex-col gap-2">
      {rows.map(({ cat, meetings }) => (
        <li
          key={cat.id}
          className="rounded-xl border border-line/80 bg-surface-sunken/40 px-3 py-2.5"
        >
          <p className="text-[12.5px] font-medium text-ink">{cat.name}</p>
          {meetings.map((meeting) => (
            <p key={meeting.repeatId} className="text-[12.5px] text-ink-soft">
              {formatMeetingSummary(meeting, clock24h)}
            </p>
          ))}
        </li>
      ))}
    </ul>
  );
}
