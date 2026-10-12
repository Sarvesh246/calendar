"use client";

import { format } from "date-fns";
import { Check } from "lucide-react";
import { describeWeekDay, scheduledLabel, type WeekDaySummary } from "@/lib/agenda-week";
import { cn } from "@/lib/utils";

/**
 * The Agenda's week at a glance. Every figure is a count of real items on that
 * day — due, overdue, done, scheduled — named in words on a desk and as a
 * legend-backed dot row on a phone, where seven columns leave no room for text.
 * Tapping a day opens it on the Calendar.
 */
export function AgendaWeek({
  days,
  onOpenDay,
}: {
  days: WeekDaySummary[];
  onOpenDay: (day: WeekDaySummary) => void;
}) {
  const totals = days.reduce(
    (acc, d) => ({
      due: acc.due + d.due,
      overdue: acc.overdue + d.overdue,
      scheduled: acc.scheduled + d.classes + d.events,
    }),
    { due: 0, overdue: 0, scheduled: 0 },
  );
  const summary = [
    totals.overdue ? `${totals.overdue} overdue` : null,
    `${totals.due} due`,
    totals.scheduled ? `${totals.scheduled} scheduled` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section aria-label="This week" className="@container">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
          This week
        </h2>
        <p className="hidden text-[12px] tabular-nums text-ink-faint @2xl:block">{summary}</p>
        <WeekLegend />
      </div>
      <ol className="grid grid-cols-7 gap-1 @2xl:gap-1.5">
        {days.map((day) => (
          <li key={day.key} className="min-w-0">
            <WeekDayButton day={day} onOpen={() => onOpenDay(day)} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function WeekDayButton({ day, onOpen }: { day: WeekDaySummary; onOpen: () => void }) {
  const description = describeWeekDay(day);
  const scheduled = scheduledLabel(day.classes, day.events);
  const empty = !day.due && !day.overdue && !scheduled;
  const label = `${format(day.date, "EEEE, MMMM d")}${day.isToday ? " (today)" : ""}: ${description}. Open in Calendar`;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      title={`${format(day.date, "EEE, MMM d")} — ${description}`}
      aria-current={day.isToday ? "date" : undefined}
      className={cn(
        "press-none group flex h-full w-full flex-col items-center gap-1.5 rounded-lg border px-1 py-2 text-center",
        "@2xl:items-start @2xl:gap-2 @2xl:px-3 @2xl:py-2.5 @2xl:text-left",
        "transition-colors duration-[var(--motion-micro)]",
        day.isToday
          ? "border-accent/35 bg-accent-soft"
          : "border-line/70 bg-surface hover:border-line-strong hover:bg-surface-sunken/40",
      )}
    >
      <span className="flex flex-col items-center leading-none @2xl:flex-row @2xl:items-baseline @2xl:gap-1.5">
        <span
          className={cn(
            "text-[10.5px] font-medium uppercase tracking-[0.06em] @2xl:text-[11px]",
            day.isToday ? "text-accent" : "text-ink-faint",
          )}
        >
          <span className="@2xl:hidden">{format(day.date, "EEEEE")}</span>
          <span className="hidden @2xl:inline">{format(day.date, "EEE")}</span>
        </span>
        <span
          className={cn(
            "mt-1 text-[15px] font-semibold tabular-nums @2xl:mt-0",
            day.isToday ? "text-ink" : day.isPast ? "text-ink-faint" : "text-ink",
          )}
        >
          {format(day.date, "d")}
        </span>
      </span>

      {/* Desk: the counts in words. */}
      <span className="hidden min-h-[2.25rem] flex-col gap-0.5 text-[12px] leading-[1.15rem] @2xl:flex">
        {day.overdue > 0 && <span className="font-medium text-warn">{day.overdue} overdue</span>}
        {day.due > 0 && <span className="text-ink">{day.due} due</span>}
        {scheduled && <span className="text-ink-faint">{scheduled}</span>}
        {empty &&
          (day.done > 0 ? (
            <span className="flex items-center gap-1 text-ink-faint">
              <Check aria-hidden className="h-3 w-3 text-good" strokeWidth={2.5} />
              {day.done} done
            </span>
          ) : (
            <span className="text-ink-faint">Free</span>
          ))}
      </span>

      {/* Phone: one dot per kind, explained by the legend above. */}
      <span aria-hidden className="flex h-1.5 items-center justify-center gap-[3px] @2xl:hidden">
        {day.overdue > 0 && <span className="h-[5px] w-[5px] rotate-45 rounded-[1px] bg-warn" />}
        {day.due > 0 && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
        {scheduled && <span className="h-1.5 w-1.5 rounded-full border border-ink-faint" />}
        {empty && day.done > 0 && <span className="h-1.5 w-1.5 rounded-full bg-good" />}
      </span>
    </button>
  );
}

function WeekLegend() {
  return (
    <p className="flex items-center gap-2.5 text-[11px] text-ink-faint @2xl:hidden">
      <span className="flex items-center gap-1">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
        Due
      </span>
      <span className="flex items-center gap-1">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full border border-ink-faint" />
        Scheduled
      </span>
      <span className="flex items-center gap-1">
        <span aria-hidden className="h-[5px] w-[5px] rotate-45 rounded-[1px] bg-warn" />
        Overdue
      </span>
    </p>
  );
}
