"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { formatDistanceToNowStrict } from "date-fns";
import {
  classCountdownLabel,
  eventRemainingLabel,
  eventSessionBounds,
  formatTime,
  isClassStartingSoon,
  isHappeningNow,
} from "@/lib/date-utils";
import { isClassMeeting } from "@/lib/class-schedule";
import { classCountdownWindowMs } from "@/lib/class-reminder";
import { useDatebookStore } from "@/lib/store";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens, prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Category, Item } from "@/lib/types";

export type UpNextMode = "live" | "soon" | "next";

export function UpNextCard({ item, category }: { item: Item; category: Category | undefined }) {
  return <UpNextFace item={item} category={category} />;
}

export function UpNextStack({
  happening,
  startingSoon = [],
  upcoming,
  categoryOf,
}: {
  happening: Item[];
  startingSoon?: Item[];
  upcoming?: Item;
  categoryOf: (item: Item) => Category | undefined;
}) {
  const happeningIds = useMemo(() => new Set(happening.map((i) => i.id)), [happening]);
  const soonItems = startingSoon.filter((i) => !happeningIds.has(i.id));
  const soonIds = new Set(soonItems.map((i) => i.id));
  const items =
    happening.length > 0 || soonItems.length > 0
      ? [...happening, ...soonItems]
      : upcoming
        ? [upcoming]
        : [];
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const dragged = useRef(false);
  const wheelLock = useRef(0);
  const stackRef = useRef<HTMLDivElement>(null);

  const count = items.length;
  const safeIndex = count === 0 ? 0 : Math.min(index, count - 1);

  useEffect(() => {
    const el = stackRef.current;
    if (!el || count < 2) return;
    const onWheel = (e: WheelEvent) => {
      if (expanded) return;
      if (Math.abs(e.deltaX) < 28 || Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
      e.preventDefault();
      const now = Date.now();
      if (now - wheelLock.current < 380) return;
      wheelLock.current = now;
      haptic("light");
      setIndex((i) => {
        const cur = Math.min(i, count - 1);
        return (cur + (e.deltaX > 0 ? 1 : -1) + count) % count;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [count, expanded]);

  if (count === 0) return null;
  const current = items[safeIndex];

  function modeOf(item: Item): UpNextMode {
    if (happeningIds.has(item.id)) return "live";
    if (soonIds.has(item.id)) return "soon";
    return "next";
  }

  const liveCount = happening.length;
  const soonCount = soonItems.length;
  const stackLabel =
    liveCount > 0 && soonCount === 0
      ? "Happening now"
      : soonCount > 0 && liveCount === 0
        ? "Starting soon"
        : "Now";

  function go(dir: -1 | 1) {
    if (count < 2) return;
    haptic("light");
    setIndex((i) => {
      const cur = Math.min(i, count - 1);
      return (cur + dir + count) % count;
    });
  }

  const reduce = prefersReducedMotion();

  return (
    <div>
      <AnimatePresence initial={false} mode="wait">
        {expanded && count > 1 ? (
          <motion.div
            key="list"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
            className="flex flex-col gap-2"
          >
            <div className="flex items-center justify-between px-0.5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">
                {stackLabel} · {count}
              </p>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="text-[12px] font-medium text-ink-soft hover:text-ink"
              >
                Show one
              </button>
            </div>
            {items.map((item) => (
              <UpNextFace
                key={item.id}
                item={item}
                category={categoryOf(item)}
                mode={modeOf(item)}
              />
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="pager"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
          >
            <div
              ref={stackRef}
              className="relative"
              style={{ paddingBottom: count > 1 ? (count > 2 ? 20 : 14) : 0 }}
              onKeyDown={(e) => {
                if (count < 2) return;
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  go(1);
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  go(-1);
                }
              }}
            >
              {count > 2 && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-4 bottom-0 top-4 rounded-lg border border-line bg-surface-sunken"
                />
              )}
              {count > 1 && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-2 bottom-0 top-2 rounded-lg border border-line bg-surface-sunken"
                />
              )}
              <motion.div
                key={current.id}
                className="relative z-10 cursor-grab active:cursor-grabbing shadow-[0_16px_32px_-24px_rgba(0,0,0,0.45)]"
                style={{ touchAction: "pan-y" }}
                tabIndex={count > 1 ? 0 : undefined}
                role={count > 1 ? "group" : undefined}
                aria-label={
                  count > 1
                    ? `${stackLabel}, ${safeIndex + 1} of ${count}. Swipe or drag to switch.`
                    : undefined
                }
                drag={count > 1 && !reduce ? "x" : false}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.18}
                dragMomentum={false}
                onDragStart={() => {
                  dragged.current = true;
                }}
                onDragEnd={(_, info) => {
                  if (info.offset.x < -48 || info.velocity.x < -380) go(1);
                  else if (info.offset.x > 48 || info.velocity.x > 380) go(-1);
                  window.setTimeout(() => {
                    dragged.current = false;
                  }, 40);
                }}
                onPointerUp={() => {
                  if (dragged.current) {
                    dragged.current = false;
                    return;
                  }
                }}
                initial={reduce ? false : { opacity: 0, x: 22 }}
                animate={{ opacity: 1, x: 0 }}
                transition={motionTokens.springSnappy}
              >
                <UpNextFace
                  item={current}
                  category={categoryOf(current)}
                  interactive={false}
                  mode={modeOf(current)}
                />
              </motion.div>
            </div>
            {count > 1 && (
              <div className="mt-2.5 flex items-center justify-center gap-3">
                <p className="text-[11px] tabular-nums text-ink-faint">
                  {safeIndex + 1} of {count}
                </p>
                <div className="flex items-center gap-1.5">
                  {items.map((item, i) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-label={`Show ${item.title}`}
                      aria-current={i === safeIndex ? "true" : undefined}
                      onClick={() => setIndex(i)}
                      className={cn(
                        "h-1.5 rounded-full transition-[width,background] duration-200",
                        i === safeIndex ? "w-4 bg-accent" : "w-1.5 bg-line-strong"
                      )}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    haptic("light");
                    setExpanded(true);
                  }}
                  className="text-[12px] font-medium text-ink-soft hover:text-ink"
                >
                  Show all
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function UpNextFace({
  item,
  category,
  interactive = true,
  mode,
}: {
  item: Item;
  category: Category | undefined;
  interactive?: boolean;
  mode?: UpNextMode;
}) {
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const showLocation = useDatebookStore((s) => s.settings.showLocation);
  const classReminderMinutes = useDatebookStore((s) => s.settings.classReminderMinutes);
  const [now, setNow] = useState(() => new Date());
  const isClass = isClassMeeting(item, category?.name);
  const started = isHappeningNow(item, now) || mode === "live";
  const soon =
    !started &&
    (mode === "soon" ||
      isClassStartingSoon(item, now, classCountdownWindowMs(classReminderMinutes)));

  useEffect(() => {
    const ms = soon ? 1000 : 15_000;
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [soon]);

  const color = category?.color ?? "#8a8a93";
  const start = new Date(item.at);
  const end = item.endAt ? new Date(item.endAt) : null;
  const remaining = eventRemainingLabel(item, now);
  const session = started ? eventSessionBounds(item, now) : null;
  const progress =
    session && session.end.getTime() > session.start.getTime()
      ? Math.min(
          1,
          Math.max(
            0,
            (now.getTime() - session.start.getTime()) /
              (session.end.getTime() - session.start.getTime())
          )
        )
      : 0;

  const eyebrow = started
    ? isClass
      ? "In class"
      : "Happening now"
    : soon
      ? "Class starts soon"
      : "Up next";
  const aside = started
    ? item.allDay
      ? remaining
      : null
    : soon
      ? classCountdownLabel(start, now)
      : formatDistanceToNowStrict(start, { addSuffix: false });

  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-surface p-5",
        interactive && "cursor-default"
      )}
    >
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
        {started && <span aria-hidden className="live-dot h-1.5 w-1.5 rounded-full bg-accent" />}
        {eyebrow}
      </p>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <h3 className="line-clamp-2 break-words text-[17px] font-semibold text-ink">{item.title}</h3>
        <span className="shrink-0 text-[12px] tabular-nums text-ink-soft" suppressHydrationWarning>
          {aside}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-soft">
        <span className="tabular-nums font-medium text-ink-soft">
          {item.allDay ? "All day" : formatTime(item.at, clock24h)}
          {!item.allDay && end && ` – ${formatTime(item.endAt!, clock24h)}`}
        </span>
        {showLocation && item.location && <span className="truncate">{item.location}</span>}
        {category && (
          <span className="flex items-center gap-1.5 text-[12px] text-ink-faint">
            <span className="h-2 w-2 rounded-full" style={{ background: color }} />
            {category.name}
          </span>
        )}
      </div>
      {started && !item.allDay && end && (
        <div className="mt-4 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
              style={{
                width: `${Math.min(100, Math.max(0, progress * 100))}%`,
              }}
            />
          </div>
          {remaining && (
            <span className="shrink-0 text-[11px] tabular-nums text-ink-faint" suppressHydrationWarning>
              {remaining}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
