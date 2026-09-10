"use client";

import { CalendarClock } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { formatMeetingSummary, savedClassMeetings, type SavedClassMeeting } from "@/lib/class-schedule";
import { haptic } from "@/lib/haptic";
import type { Category } from "@/lib/types";

function removeMeeting(meeting: SavedClassMeeting) {
  haptic("warn");
  useDatebookStore.getState().deleteSeries(meeting.repeatId);
  const leftover = useDatebookStore
    .getState()
    .items.filter((item) => meeting.ids.includes(item.id));
  for (const item of leftover) useDatebookStore.getState().deleteItem(item.id);
}

function SavedMeetingRow({
  meeting,
  clock24h,
  color,
}: {
  meeting: SavedClassMeeting;
  clock24h: boolean;
  color?: string;
}) {
  const summary = formatMeetingSummary(meeting, clock24h);
  return (
    <div className="flex min-h-11 items-center gap-2 px-0.5">
      <CalendarClock
        className="h-3.5 w-3.5 shrink-0"
        strokeWidth={1.75}
        style={color ? { color } : undefined}
      />
      <p className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{summary}</p>
      <button
        type="button"
        aria-label={`Remove ${summary}`}
        onClick={() => removeMeeting(meeting)}
        className="shrink-0 text-[12px] font-medium text-warn"
      >
        Remove
      </button>
    </div>
  );
}

export function CategoryClassTimesControl({ category }: { category: Category }) {
  const items = useDatebookStore((s) => s.items);
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const openClassSchedule = useUIStore((s) => s.openClassSchedule);
  const meetings = savedClassMeetings(items, category.id);
  const saved = meetings.length > 0;

  return (
    <div className="flex flex-col">
      {meetings.map((meeting) => (
        <SavedMeetingRow
          key={meeting.repeatId}
          meeting={meeting}
          clock24h={clock24h}
          color={category.color}
        />
      ))}
      <button
        type="button"
        onClick={() => {
          haptic("light");
          openClassSchedule(category.id);
        }}
        className="flex min-h-11 items-center gap-2 rounded-lg px-0.5 text-left text-[13px] font-medium text-ink-soft transition-colors hover:bg-surface-sunken/50 hover:text-ink"
      >
        <CalendarClock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        {saved ? "Add another time" : "Class times"}
      </button>
    </div>
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
          className="rounded-xl border border-line/80 bg-surface-sunken/40 px-3 py-1.5"
        >
          <p className="pt-1 text-[12.5px] font-medium text-ink">{cat.name}</p>
          {meetings.map((meeting) => (
            <SavedMeetingRow
              key={meeting.repeatId}
              meeting={meeting}
              clock24h={clock24h}
              color={cat.color}
            />
          ))}
        </li>
      ))}
    </ul>
  );
}
