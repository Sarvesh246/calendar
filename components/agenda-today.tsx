"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";
import { haptic } from "@/lib/haptic";
import { formatTime, formatTimeSpan, isEventEnded } from "@/lib/date-utils";
import { useNow } from "@/lib/use-now";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { handleItemMenuKey, itemMenuProps } from "@/lib/item-menu";
import { Reveal } from "@/components/ui/reveal";
import { cn } from "@/lib/utils";
import type { Item } from "@/lib/types";
import { itemDisplayTitle } from "@/lib/course-label";

/**
 * Today, folded into the top of the Agenda.
 *
 * Collapsed by default so the Agenda leads with what is *next*; open it to see
 * the whole day — including everything already finished, crossed out. The
 * Today tab remains the place to work through the day; this is the glance.
 */
export function AgendaTodayDropdown({ items }: { items: Item[] }) {
  const [open, setOpen] = useState(false);
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const categories = useDatebookStore((s) => s.categories);
  const openInspector = useUIStore((s) => s.openInspector);
  const now = useNow();

  if (items.length === 0) return null;

  // Work is done when it's ticked off; a class or event is done once it's over.
  const isDone = (i: Item) => (i.type === "event" ? isEventEnded(i, now) : i.status === "done");
  const done = items.filter(isDone).length;
  const left = items.length - done;
  const summary =
    left === 0
      ? `All ${items.length} done`
      : done > 0
        ? `${left} left · ${done} done`
        : `${left} item${left === 1 ? "" : "s"}`;

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          haptic("light");
          setOpen((v) => !v);
        }}
        className="press-none flex min-h-12 w-full items-center gap-3 px-4 text-left transition-colors duration-[var(--motion-micro)] hover:bg-surface-sunken/50"
      >
        <span className="text-[14px] font-semibold text-ink">Today</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink-soft">{summary}</span>
        <ChevronDown
          aria-hidden
          className={cn("h-4 w-4 shrink-0 text-ink-faint transition-transform duration-[var(--motion-standard)]", open && "rotate-180")}
          strokeWidth={2}
        />
      </button>
      <Reveal open={open}>
        <div className="border-t border-line">
          {items.map((item) => {
            const finished = isDone(item);
            const event = item.type === "event";
            const live = event && !finished && !item.allDay && new Date(item.at).getTime() <= now.getTime();
            const color = categories.find((c) => c.id === item.categoryId)?.color ?? "#8a8a94";
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => openInspector(item.id)}
                onKeyDown={(e) => handleItemMenuKey(e, item.id)}
                {...itemMenuProps(item.id)}
                className="flex min-h-11 w-full items-center gap-3 border-t border-line px-4 py-2 text-left transition-colors duration-[var(--motion-micro)] first:border-t-0 hover:bg-surface-sunken/50 focus-visible:bg-surface-sunken/50 focus-visible:outline-none"
              >
                {event ? (
                  // Scheduled time, not a to-do: a colour bar like the
                  // calendar's event chips, so there's nothing to tick.
                  <span aria-hidden className="flex h-4 w-4 shrink-0 items-center justify-center">
                    <span
                      className={cn("h-4 w-[3px] rounded-full", finished && "opacity-40")}
                      style={{ background: color }}
                    />
                  </span>
                ) : (
                  <span
                    aria-hidden
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                      finished ? "bg-good text-white" : "border"
                    )}
                    style={finished ? undefined : { borderColor: color }}
                  >
                    {finished && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
                  </span>
                )}
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[13.5px] font-medium",
                    finished ? "text-ink-faint" : "text-ink",
                    finished && !event && "line-through decoration-ink-faint"
                  )}
                >
                  {itemDisplayTitle(item)}
                </span>
                {event && (finished || live) && (
                  <span className={cn("shrink-0 text-[12px] font-medium", live ? "text-accent" : "text-ink-faint")}>
                    {live ? "Now" : "Ended"}
                  </span>
                )}
                <span className="shrink-0 text-[12px] tabular-nums text-ink-faint">
                  {item.allDay
                    ? "All day"
                    : event
                      ? formatTimeSpan(item.at, item.endAt, clock24h)
                      : formatTime(item.at, clock24h)}
                </span>
              </button>
            );
          })}
          <Link
            href="/today"
            className="flex min-h-11 items-center justify-center border-t border-line text-[13px] font-medium text-accent transition-colors hover:bg-surface-sunken/50"
          >
            Open Today
          </Link>
        </div>
      </Reveal>
    </section>
  );
}
