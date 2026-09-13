"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { format, isSameDay, isToday } from "date-fns";
import { useDatebookStore } from "@/lib/store";
import { groupItemsByDay, dayKey, dayLabel, formatTime, isEventEnded } from "@/lib/date-utils";
import { useCategoriesById, useItemCardChrome } from "@/lib/card-chrome";
import { ItemCard } from "@/components/item-card";
import { EmptyState } from "@/components/empty-state";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { assignOverlapColumns } from "@/lib/event-layout";
import type { Item } from "@/lib/types";
import { weekEventWindow } from "@/lib/week-layout";
import { beginCalendarDrag, HOUR_HEIGHT, useCalendarDrag } from "@/lib/calendar-drag";
import {
  dayAtMinute,
  MIN_DURATION_MINUTES,
  movedTimes,
  resizedEnd,
  snapMinutes,
  sweptRange,
} from "@/lib/calendar-drag-math";
import { minuteLabel, slotLabel } from "@/lib/slot-label";
import { applyItemPatch, dayLabelFor, rescheduleToDay } from "@/lib/item-actions";
import { handleItemMenuKey, itemMenuProps } from "@/lib/item-menu";
import { formatDuration } from "@/lib/work-sessions";

const DEFAULT_START_HOUR = 7;
const DEFAULT_END_HOUR = 22;
const NO_ITEMS: Item[] = [];

const clampHour = (h: number) => Math.max(0, Math.min(24, h));

/** Timed events outside 07:00–22:00 used to be clamped onto the first row or
 *  scrolled off the bottom with no affordance. Widen the window so it always
 *  covers every timed event visible this week. */
function hourWindow(days: Date[], byDay: Map<string, Item[]>) {
  let start = DEFAULT_START_HOUR;
  let end = DEFAULT_END_HOUR;
  for (const day of days) {
    for (const it of byDay.get(dayKey(day)) ?? NO_ITEMS) {
      if (it.type !== "event" || it.allDay) continue;
      const session = weekEventWindow(it, day);
      start = Math.min(start, Math.floor(session.startMin / 60));
      end = Math.max(end, Math.ceil(session.endMin / 60));
    }
  }
  return { startHour: clampHour(start), endHour: clampHour(Math.max(end, start + 1)) };
}

export function WeekView({
  days,
  items,
  onSelectDate,
  onSelectItem,
  onCreate,
}: {
  days: Date[];
  items: Item[];
  onSelectDate?: (date: Date) => void;
  onSelectItem?: (item: Item, day: Date) => void;
  /** A tap on empty time (`durationMin` null) or a span swept across it. */
  onCreate?: (day: Date, startMin: number, durationMin: number | null) => void;
}) {
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const categories = useDatebookStore((s) => s.categories);
  const lastPointer = useRef<string>("mouse");

  const byDay = useMemo(() => groupItemsByDay(items), [items]);
  const { startHour, endHour } = useMemo(() => hourWindow(days, byDay), [days, byDay]);
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const colorOf = useMemo(() => {
    const m = new Map(categories.map((c) => [c.id, c.color] as const));
    return (categoryId: string) => m.get(categoryId) ?? "#8a8a94";
  }, [categories]);

  const select = (item: Item, day: Date) => {
    if (onSelectItem) onSelectItem(item, day);
    else onSelectDate?.(day);
  };

  /** Press on empty time: a tap asks to add there, a sweep sizes the new event. */
  function startCreate(e: React.PointerEvent<HTMLDivElement>, day: Date) {
    lastPointer.current = e.pointerType;
    if (!onCreate || e.button !== 0 || e.pointerType === "touch") return;
    if ((e.target as HTMLElement).closest("[data-block]")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const anchorMin = startHour * 60 + ((e.clientY - rect.top) / HOUR_HEIGHT) * 60;
    const key = dayKey(day);
    const lo = startHour * 60;
    const hi = endHour * 60;
    e.preventDefault();
    beginCalendarDrag(e, {
      accept: ["slot"],
      threshold: 4,
      resolve: (t) => {
        if (t.kind !== "slot") return null;
        const r = sweptRange(anchorMin, t.minute, lo, hi);
        return {
          preview: { dayKey: key, ...r, tone: "create", title: "New event" },
          label: `${slotLabel(key, r.startMin, r.endMin, clock24h)} · ${formatDuration(r.endMin - r.startMin)}`,
        };
      },
      onDrop: (t) => {
        if (t.kind !== "slot") return;
        const r = sweptRange(anchorMin, t.minute, lo, hi);
        onCreate(day, r.startMin, r.endMin - r.startMin);
      },
      onTap: () => onCreate(day, Math.max(lo, Math.floor(anchorMin / 30) * 30), null),
    });
  }

  return (
    <>
      <MobileWeekPager days={days} byDay={byDay} />

      <div
        data-drop-scroll
        className="hidden min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface md:flex md:overflow-y-auto"
      >
        <div data-drop-sticky className="sticky top-0 z-10 grid grid-cols-[48px_repeat(7,1fr)] border-b border-line bg-surface">
          <div />
          {days.map((day) => (
            <button
              key={day.toISOString()}
              type="button"
              data-drop-head={dayKey(day)}
              onClick={() => onSelectDate?.(day)}
              className={cn(
                "week-day-head border-l border-line px-2 py-2 text-center transition-colors duration-[var(--motion-micro)]",
                isToday(day) && "bg-accent-soft"
              )}
            >
              <p className="text-[10.5px] font-medium uppercase tracking-wider text-ink-faint">{format(day, "EEE")}</p>
              <p className={cn("text-[15px] font-medium tabular-nums", isToday(day) ? "text-accent" : "text-ink")}>
                {format(day, "d")}
              </p>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-[48px_repeat(7,1fr)] border-b border-line">
          <div className="py-1.5 text-right text-[10px] text-ink-faint" />
          {days.map((day) => {
            const key = dayKey(day);
            const dayAssignments = (byDay.get(key) ?? NO_ITEMS).filter((i) => i.type !== "event" || i.allDay);
            const visible = dayAssignments.slice(0, 2);
            const overflow = dayAssignments.length - visible.length;
            const hiddenTitles = dayAssignments
              .slice(2)
              .map((i) => i.title)
              .join(", ");
            return (
              <div
                key={day.toISOString()}
                data-drop-day={key}
                className="week-allday-cell flex min-h-7 flex-col gap-1 border-l border-line p-1 transition-colors duration-[var(--motion-micro)]"
              >
                {visible.map((item) => (
                  <AllDayChip
                    key={item.id}
                    item={item}
                    day={day}
                    color={colorOf(item.categoryId)}
                    clock24h={clock24h}
                    startHour={startHour}
                    endHour={endHour}
                    onSelect={() => select(item, day)}
                  />
                ))}
                {overflow > 0 && (
                  <button
                    type="button"
                    onClick={() => onSelectDate?.(day)}
                    title={hiddenTitles}
                    className="truncate rounded px-1.5 py-0.5 text-left text-[10px] font-medium text-ink-soft"
                  >
                    +{overflow}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="relative grid grid-cols-[48px_repeat(7,1fr)]">
          <div>
            {hours.map((h) => (
              <div key={h} style={{ height: HOUR_HEIGHT }} className="border-b border-line pr-2 text-right text-[10px] text-ink-faint">
                {format(new Date(0, 0, 0, h), clock24h ? "HH:00" : "h a")}
              </div>
            ))}
          </div>
          {days.map((day) => {
            const key = dayKey(day);
            const dayEvents = (byDay.get(key) ?? NO_ITEMS).filter((i) => i.type === "event" && !i.allDay);
            return (
              <div
                key={day.toISOString()}
                data-drop-col={key}
                data-start-hour={startHour}
                onPointerDown={(e) => startCreate(e, day)}
                className="relative border-l border-line"
              >
                {hours.map((h) => (
                  <button
                    key={h}
                    type="button"
                    aria-label={`Add at ${format(new Date(0, 0, 0, h), clock24h ? "HH:00" : "h a")} on ${format(day, "EEEE, MMMM d")}`}
                    // Mouse presses are handled by the column (tap or sweep);
                    // this covers the keyboard and touch.
                    onClick={(e) => {
                      if (e.detail === 0 || lastPointer.current === "touch") onCreate?.(day, h * 60, null);
                    }}
                    style={{ height: HOUR_HEIGHT }}
                    className="block w-full border-b border-line transition-colors duration-[var(--motion-micro)] hover:bg-accent-soft/50 active:bg-accent-soft"
                  />
                ))}
                {assignOverlapColumns(
                  dayEvents.map((item) => {
                    const session = weekEventWindow(item, day);
                    const startMin = session.startMin - startHour * 60;
                    const durationMin = session.endMin - session.startMin;
                    return {
                      item,
                      startMin,
                      endMin: startMin + Math.max(20, durationMin),
                      durationMin,
                      absStart: session.startMin,
                      absEnd: session.endMin,
                    };
                  })
                ).map(({ item, startMin, durationMin, col, colCount, absStart, absEnd }) => (
                  <TimedBlock
                    key={item.id}
                    item={item}
                    day={day}
                    top={Math.max(0, (startMin / 60) * HOUR_HEIGHT)}
                    height={Math.max(22, (durationMin / 60) * HOUR_HEIGHT - 2)}
                    color={colorOf(item.categoryId)}
                    widthPct={100 / colCount}
                    col={col}
                    clock24h={clock24h}
                    startHour={startHour}
                    endHour={endHour}
                    absStart={absStart}
                    absEnd={absEnd}
                    onSelect={() => select(item, day)}
                  />
                ))}
                <DropGhost dayKey={key} startHour={startHour} clock24h={clock24h} />
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/** Where the current drag will land in this column. */
function DropGhost({ dayKey: key, startHour, clock24h }: { dayKey: string; startHour: number; clock24h: boolean }) {
  const preview = useCalendarDrag((s) => (s.preview?.dayKey === key ? s.preview : null));
  if (!preview) return null;
  const top = Math.max(0, ((preview.startMin - startHour * 60) / 60) * HOUR_HEIGHT);
  const height = Math.max(20, ((preview.endMin - preview.startMin) / 60) * HOUR_HEIGHT - 2);
  const color = preview.color ?? "var(--accent)";
  const due = preview.tone === "due";
  return (
    <div
      aria-hidden
      className={cn(
        "drag-ghost pointer-events-none absolute inset-x-1 z-[4] overflow-hidden rounded-md border-2 px-1.5 py-1 text-[10.5px] leading-tight",
        preview.tone === "move" ? "border-solid" : "border-dashed"
      )}
      style={{
        top,
        height: due ? 22 : height,
        borderColor: color,
        backgroundColor: `color-mix(in srgb, ${color} ${preview.tone === "create" ? 12 : 20}%, var(--surface))`,
        boxShadow: "0 10px 24px -12px rgb(0 0 0 / 0.35)",
      }}
    >
      <p className="truncate font-medium text-ink">{preview.title ?? "New event"}</p>
      {!due && height > 30 && (
        <p className="truncate tabular-nums text-ink-soft">
          {minuteLabel(key, preview.startMin, clock24h)} – {minuteLabel(key, preview.endMin, clock24h)}
        </p>
      )}
    </div>
  );
}

/**
 * A timed event block. Drag it to another time or day; drag its bottom edge to
 * change how long it runs. The block itself stays put and fades while a ghost
 * shows exactly where it will land — on the same 15-minute grid the commit
 * uses — and every change comes with Undo.
 */
function TimedBlock({
  item,
  day,
  top,
  height,
  color,
  widthPct,
  col,
  clock24h,
  startHour,
  endHour,
  absStart,
  absEnd,
  onSelect,
}: {
  item: Item;
  day: Date;
  top: number;
  height: number;
  color: string;
  widthPct: number;
  col: number;
  clock24h: boolean;
  startHour: number;
  endHour: number;
  absStart: number;
  absEnd: number;
  onSelect: () => void;
}) {
  const key = dayKey(day);
  const lifted = useCalendarDrag((s) => s.sourceId === item.id);
  // Only the segment where the event actually ends has an edge to pull.
  const canResize = !item.endAt || isSameDay(new Date(item.endAt), day);
  const ended = isEventEnded(item, new Date(), day);

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const column = e.currentTarget.parentElement;
    if (!column) return;
    const rect = column.getBoundingClientRect();
    const pointerMin = startHour * 60 + ((e.clientY - rect.top) / HOUR_HEIGHT) * 60;
    const lo = startHour * 60;
    const hi = endHour * 60;

    if (canResize && (e.target as HTMLElement).closest("[data-resize]")) {
      e.preventDefault();
      const endFor = (m: number) => Math.max(absStart + MIN_DURATION_MINUTES, Math.min(hi, snapMinutes(m)));
      beginCalendarDrag(e, {
        accept: ["slot"],
        threshold: 2,
        resolve: (t) => {
          if (t.kind !== "slot") return null;
          const end = endFor(t.minute);
          return {
            preview: { dayKey: key, startMin: absStart, endMin: end, tone: "move", color, title: item.title },
            label: `Ends ${minuteLabel(key, end, clock24h)} · ${formatDuration(end - absStart)}`,
          };
        },
        onDrop: (t) => {
          if (t.kind !== "slot") return;
          const end = endFor(t.minute);
          if (item.endAt && end === absEnd) return;
          applyItemPatch(item, { endAt: resizedEnd(item, key, end) }, `Now ends at ${minuteLabel(key, end, clock24h)}`);
        },
      });
      return;
    }

    const grab = pointerMin - absStart;
    const length = Math.max(MIN_DURATION_MINUTES, absEnd - absStart);
    const latest = Math.max(lo, hi - length);
    const startFor = (m: number) => Math.min(latest, Math.max(lo, snapMinutes(m - grab)));
    beginCalendarDrag(e, {
      accept: ["slot"],
      sourceId: item.id,
      threshold: 5,
      resolve: (t) => {
        if (t.kind !== "slot") return null;
        const s = startFor(t.minute);
        return {
          preview: { dayKey: t.dayKey, startMin: s, endMin: s + length, tone: "move", color, title: item.title },
          label: slotLabel(t.dayKey, s, s + length, clock24h),
        };
      },
      onDrop: (t) => {
        if (t.kind !== "slot") return;
        const s = startFor(t.minute);
        if (t.dayKey === key && s === absStart) return;
        applyItemPatch(
          item,
          movedTimes(item, key, absStart, t.dayKey, s),
          `Moved to ${slotLabel(t.dayKey, s, null, clock24h)}`
        );
      },
      onTap: onSelect,
    });
  }

  return (
    <button
      type="button"
      data-block
      onPointerDown={onPointerDown}
      onClick={(e) => {
        // Pointer taps open from the drag's tap; Enter/Space arrive as a click
        // with no pointer behind it (`detail === 0`).
        if (e.detail === 0) onSelect();
      }}
      onKeyDown={(e) => handleItemMenuKey(e, item.id, key)}
      {...itemMenuProps(item.id, key)}
      title={`${item.title} · ${formatTime(item.at, clock24h)}${item.endAt ? ` – ${formatTime(item.endAt, clock24h)}` : ""}`}
      style={{
        top,
        height,
        left: `calc(${col * widthPct}% + 4px)`,
        width: `calc(${widthPct}% - 8px)`,
        backgroundColor: `color-mix(in srgb, ${color} 14%, var(--surface))`,
        borderLeft: `2.5px ${item.workFor ? "dashed" : "solid"} ${color}`,
        opacity: lifted ? 0.35 : undefined,
        zIndex: 1,
        touchAction: "none",
        ["--cat" as string]: color,
      }}
      className={cn(
        "group/block press-none absolute cursor-grab overflow-hidden rounded-md px-1.5 py-1 text-left text-[10.5px] leading-tight",
        "transition-opacity duration-[var(--motion-micro)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        item.workFor && "work-session-block",
        ended && !lifted && "opacity-45"
      )}
    >
      <p className="truncate font-medium" style={{ color }}>
        {item.title}
      </p>
      {height > 32 && (
        <p className="truncate tabular-nums text-ink-faint">
          {formatTime(item.at, clock24h)}
          {height > 48 && item.endAt ? ` – ${formatTime(item.endAt, clock24h)}` : ""}
        </p>
      )}
      {canResize && (
        <span
          data-resize
          aria-hidden
          className="absolute inset-x-0 bottom-0 flex h-2.5 cursor-ns-resize items-end justify-center pb-[2px]"
        >
          <span
            className="h-[3px] w-6 rounded-full opacity-0 transition-opacity duration-[var(--motion-micro)] group-hover/block:opacity-50"
            style={{ backgroundColor: color }}
          />
        </span>
      )}
    </button>
  );
}

/** An all-day or due item in the week's top row. Carry it to another day, or
 *  (for work) down into the grid to give it a due time. */
function AllDayChip({
  item,
  day,
  color,
  clock24h,
  startHour,
  endHour,
  onSelect,
}: {
  item: Item;
  day: Date;
  color: string;
  clock24h: boolean;
  startHour: number;
  endHour: number;
  onSelect: () => void;
}) {
  const key = dayKey(day);
  const lifted = useCalendarDrag((s) => s.sourceId === item.id);
  const touch = useRef(false);
  const work = item.type !== "event";

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    touch.current = e.pointerType === "touch";
    if (e.button !== 0 || touch.current) return;
    const slotFor = (m: number) => Math.max(startHour * 60, Math.min(endHour * 60 - 15, snapMinutes(m)));
    beginCalendarDrag(e, {
      accept: work ? ["day", "slot"] : ["day"],
      sourceId: item.id,
      resolve: (t) => {
        if (t.kind === "day") {
          return { label: t.dayKey === key ? "Keep on this day" : `${work ? "Due" : "Move to"} ${dayLabelFor(t.dayKey)}` };
        }
        const m = slotFor(t.minute);
        return {
          preview: { dayKey: t.dayKey, startMin: m, endMin: m + 30, tone: "due", color, title: `Due · ${item.title}` },
          label: `Due ${slotLabel(t.dayKey, m, null, clock24h)}`,
        };
      },
      onDrop: (t) => {
        if (t.kind === "day") {
          rescheduleToDay(item, t.dayKey, key);
          return;
        }
        const m = slotFor(t.minute);
        const at = dayAtMinute(t.dayKey, m).toISOString();
        if (at === item.at && !item.allDay) return;
        applyItemPatch(item, { at, allDay: false }, `Due ${slotLabel(t.dayKey, m, null, clock24h)}`);
      },
      onTap: onSelect,
    });
  }

  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onClick={(e) => {
        if (e.detail === 0 || touch.current) onSelect();
      }}
      onKeyDown={(e) => handleItemMenuKey(e, item.id, key)}
      {...itemMenuProps(item.id, key)}
      className={cn(
        "cal-chip cursor-grab truncate px-1.5 py-0.5 text-left text-[10px] font-medium transition-opacity duration-[var(--motion-micro)]",
        work && "cal-chip-task",
        (item.status === "done" || isEventEnded(item, new Date(), day)) && "opacity-45",
        lifted && "opacity-30"
      )}
      style={{ "--cat": color } as React.CSSProperties}
    >
      {item.title}
    </button>
  );
}

function MobileWeekPager({
  days,
  byDay,
}: {
  days: Date[];
  byDay: Map<string, Item[]>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(() => Math.max(0, days.findIndex((d) => isToday(d))));
  const pageIndex = useRef(page);
  const chrome = useItemCardChrome();
  const categories = useCategoriesById();

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const idx = Math.max(0, days.findIndex((d) => isToday(d)));
    pageIndex.current = idx;
    const sync = () => {
      if (!el.clientWidth) return;
      el.scrollTo({ left: el.clientWidth * pageIndex.current, behavior: "instant" });
      setPage(pageIndex.current);
    };
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [days]);

  return (
    <div className="flex min-h-0 flex-1 flex-col md:hidden">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          const next = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          if (!el.clientWidth) return;
          pageIndex.current = next;
          setPage((p) => (p === next ? p : next));
        }}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-page-swipe="off"
      >
        {days.map((day, i) => {
          const dayItems = byDay.get(dayKey(day)) ?? NO_ITEMS;
          const label = dayLabel(day);
          const near = Math.abs(i - page) <= 1;
          return (
            <section
              key={day.toISOString()}
              className="h-full w-full shrink-0 snap-start overflow-y-auto overscroll-y-contain px-2"
            >
              <div className="mb-3 flex items-baseline justify-between">
                <p className="text-[15px] font-semibold text-ink">{label}</p>
                <p className="text-[12.5px] text-ink-faint">{format(day, "MMM d")}</p>
              </div>
              {dayItems.length === 0 ? (
                <EmptyState title="Nothing scheduled." sub="A free day." />
              ) : near ? (
                <div className="flex flex-col gap-2">
                  {dayItems.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      category={item.categoryId ? categories.get(item.categoryId) : undefined}
                      day={day}
                      {...chrome}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-ink-faint">
                  {dayItems.length} item{dayItems.length === 1 ? "" : "s"}
                </p>
              )}
            </section>
          );
        })}
      </div>
      <div className="mt-3 flex justify-center gap-1.5">
        {days.map((day, i) => (
          <motion.span
            key={day.toISOString()}
            aria-hidden
            // `transition-all` put width and colour on one curve; the pill now
            // widens on a spring while the colour crossfades on its own timing.
            initial={false}
            animate={{ width: i === page ? 16 : 6 }}
            transition={motionTokens.spring}
            className={cn(
              "h-1.5 rounded-full transition-colors duration-[var(--motion-standard)]",
              i === page ? "bg-accent" : "bg-line-strong"
            )}
          />
        ))}
      </div>
    </div>
  );
}
