"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";
import { haptic } from "@/lib/haptic";
import { formatTime } from "@/lib/date-utils";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { handleItemMenuKey, itemMenuProps } from "@/lib/item-menu";
import { Reveal } from "@/components/ui/reveal";
import { cn } from "@/lib/utils";
import type { Item } from "@/lib/types";

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

  if (items.length === 0) return null;

  const isDone = (i: Item) => i.type !== "event" && i.status === "done";
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
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[13.5px] font-medium",
                    finished ? "text-ink-soft line-through decoration-ink-faint" : "text-ink"
                  )}
                >
                  {item.title}
                </span>
                <span className="shrink-0 text-[12px] tabular-nums text-ink-faint">
                  {item.allDay ? "All day" : formatTime(item.at, clock24h)}
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
