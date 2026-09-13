"use client";

import { useMemo, useState } from "react";
import { addDays, format, startOfDay } from "date-fns";
import { CalendarPlus, GripVertical } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useCategoriesById } from "@/lib/card-chrome";
import { useNow } from "@/lib/use-now";
import { formatTime, isOverdueAt } from "@/lib/date-utils";
import { beginCalendarDrag } from "@/lib/calendar-drag";
import { dayAtMinute, snapMinutes } from "@/lib/calendar-drag-math";
import { slotLabel } from "@/lib/slot-label";
import { planWorkSession } from "@/lib/item-actions";
import { handleItemMenuKey, itemMenuProps } from "@/lib/item-menu";
import { findFreeSlot, formatDuration, plannedMinutes } from "@/lib/work-sessions";
import { SESSION_LENGTHS, useWorkspacePrefs, type CalendarMode } from "@/lib/workspace-prefs";
import { EmptyState } from "@/components/empty-state";
import { haptic } from "@/lib/haptic";
import { cn } from "@/lib/utils";
import type { Category, Item } from "@/lib/types";

const HORIZON_DAYS = 30;

/**
 * Open work you haven't found time for yet. Drag a row into the week to block
 * out a session — a separate event linked to the work — or let "find time"
 * take the next free slot before it's due. The deadline never moves.
 */
export function PlanningTray({
  items,
  mode,
  onSwitchToWeek,
}: {
  items: Item[];
  mode: CalendarMode;
  onSwitchToWeek: () => void;
}) {
  const allItems = useDatebookStore((s) => s.items);
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const categories = useCategoriesById();
  const minutes = useWorkspacePrefs((s) => s.sessionMinutes);
  const setMinutes = useWorkspacePrefs((s) => s.setSessionMinutes);
  const openInspector = useUIStore((s) => s.openInspector);
  const now = useNow();
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  const canDrop = mode === "week";

  const sessionsByItem = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const i of allItems) {
      if (!i.workFor) continue;
      const list = map.get(i.workFor);
      if (list) list.push(i);
      else map.set(i.workFor, [i]);
    }
    return map;
  }, [allItems]);

  const groups = useMemo(() => {
    const today = startOfDay(now);
    const week = addDays(today, 7).getTime();
    const horizon = addDays(today, HORIZON_DAYS).getTime();
    const open = items
      .filter((i) => i.type !== "event" && i.status !== "done" && !i.workFor)
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    const overdue: Item[] = [];
    const soon: Item[] = [];
    const later: Item[] = [];
    let beyond = 0;
    for (const i of open) {
      const at = new Date(i.at).getTime();
      if (isOverdueAt(i, now)) overdue.push(i);
      else if (at < week) soon.push(i);
      else if (at < horizon) later.push(i);
      else beyond += 1;
    }
    return { overdue, soon, later, beyond };
  }, [items, now]);

  function findTime(item: Item) {
    const due = new Date(item.at);
    const before = due.getTime() > now.getTime() ? due : undefined;
    // `now` is at most a minute old; the slot rounds up to the next quarter hour.
    const slot = findFreeSlot(allItems, { from: now, minutes, before, days: 14 });
    if (!slot) {
      haptic("warn");
      setNotice({
        id: item.id,
        text: before
          ? `No free ${formatDuration(minutes)} before it's due.`
          : `No free ${formatDuration(minutes)} in the next two weeks.`,
      });
      return;
    }
    setNotice(null);
    haptic("success");
    planWorkSession(item, slot, minutes);
  }

  function startDrag(e: React.PointerEvent<HTMLElement>, item: Item, category: Category | undefined) {
    if (!canDrop || e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const length = minutes;
    const color = category?.color ?? "#8a8a94";
    // The pointer holds the block near its top, the way you'd pick up a card.
    const startFor = (m: number) => Math.max(0, Math.min(24 * 60 - length, snapMinutes(m - 15)));
    beginCalendarDrag(e, {
      accept: ["slot"],
      threshold: 4,
      resolve: (t) => {
        if (t.kind !== "slot") return null;
        const s = startFor(t.minute);
        return {
          preview: { dayKey: t.dayKey, startMin: s, endMin: s + length, tone: "plan", color, title: `Work on: ${item.title}` },
          label: `${slotLabel(t.dayKey, s, s + length, clock24h)} · ${formatDuration(length)}`,
        };
      },
      onDrop: (t) => {
        if (t.kind !== "slot") return;
        setNotice(null);
        planWorkSession(item, dayAtMinute(t.dayKey, startFor(t.minute)), length);
      },
      onTap: () => openInspector(item.id),
    });
  }

  const empty = !groups.overdue.length && !groups.soon.length && !groups.later.length;

  const renderGroup = (title: string, list: Item[], tone?: "warn") =>
    list.length > 0 && (
      <section key={title} className="mb-4 last:mb-0">
        <p className={cn("mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wider", tone === "warn" ? "text-warn" : "text-ink-faint")}>
          {title} · {list.length}
        </p>
        <ul className="flex flex-col gap-1.5">
          {list.map((item) => {
            const category = categories.get(item.categoryId);
            const planned = plannedMinutes(sessionsByItem.get(item.id) ?? []);
            const overdue = tone === "warn";
            const due = new Date(item.at);
            return (
              <li key={item.id}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={`${item.title}, due ${format(due, "EEEE, MMMM d")}${canDrop ? ". Drag onto the week to plan time." : ""}`}
                  onPointerDown={(e) => startDrag(e, item, category)}
                  onClick={(e) => {
                    if (e.detail === 0 || !canDrop) openInspector(item.id);
                  }}
                  onKeyDown={(e) => {
                    if (handleItemMenuKey(e, item.id)) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openInspector(item.id);
                    }
                  }}
                  {...itemMenuProps(item.id)}
                  style={{ touchAction: canDrop ? "none" : undefined }}
                  className={cn(
                    "group flex items-center gap-2 rounded-lg border border-line bg-surface py-2 pl-1.5 pr-1 text-left",
                    "transition-[border-color,background-color] duration-[var(--motion-micro)] hover:border-line-strong hover:bg-surface-sunken/40",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    canDrop ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
                  )}
                >
                  <GripVertical
                    aria-hidden
                    className={cn("h-3.5 w-3.5 shrink-0 text-ink-faint transition-opacity", canDrop ? "opacity-60 group-hover:opacity-100" : "opacity-25")}
                    strokeWidth={2}
                  />
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: category?.color ?? "#8a8a94" }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">{item.title}</p>
                    <p className="truncate text-[11.5px] text-ink-faint">
                      <span className={overdue ? "font-medium text-warn" : undefined}>
                        {overdue ? "Was due " : "Due "}
                        {format(due, "EEE, MMM d")}
                        {!item.allDay && ` · ${formatTime(item.at, clock24h)}`}
                      </span>
                      {planned > 0 && <span className="text-good"> · {formatDuration(planned)} planned</span>}
                    </p>
                    {notice?.id === item.id && (
                      <p role="status" className="mt-0.5 text-[11px] text-warn">
                        {notice.text}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => findTime(item)}
                    aria-label={`Find ${formatDuration(minutes)} for ${item.title}`}
                    title={`Find the next free ${formatDuration(minutes)}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-accent-soft hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <CalendarPlus className="h-4 w-4" strokeWidth={1.9} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2.5 border-b border-line px-4 py-3">
        <p className="text-[12.5px] leading-snug text-ink-soft">
          Drag work onto the week to set time aside. Deadlines stay where they are.
        </p>
        <div className="flex items-center justify-between gap-2">
          <span id="session-length-label" className="text-[11.5px] text-ink-faint">
            Session length
          </span>
          <div role="radiogroup" aria-labelledby="session-length-label" className="flex items-center gap-0.5 rounded-lg bg-surface-sunken p-0.5">
            {SESSION_LENGTHS.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={minutes === m}
                onClick={() => setMinutes(m)}
                className={cn(
                  "h-7 rounded-md px-2 text-[11.5px] font-medium tabular-nums transition-colors duration-[var(--motion-micro)]",
                  minutes === m ? "bg-surface text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-ink-soft hover:text-ink"
                )}
              >
                {formatDuration(m)}
              </button>
            ))}
          </div>
        </div>
        {!canDrop && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-accent-soft px-3 py-2 text-[12px] text-ink">
            <span>Open the week to drop work into time.</span>
            <button type="button" onClick={onSwitchToWeek} className="shrink-0 font-medium text-accent hover:underline">
              Week view
            </button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        {empty ? (
          <EmptyState title="Nothing to plan." sub={`Open assignments and tasks due in the next ${HORIZON_DAYS} days show up here.`} />
        ) : (
          <>
            {renderGroup("Overdue", groups.overdue, "warn")}
            {renderGroup("Next 7 days", groups.soon)}
            {renderGroup("Later", groups.later)}
            {groups.beyond > 0 && (
              <p className="px-1 pt-1 text-[11.5px] text-ink-faint">
                {groups.beyond} more due after {format(addDays(startOfDay(now), HORIZON_DAYS), "MMM d")}.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
