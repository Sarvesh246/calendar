"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { formatDistanceToNowStrict } from "date-fns";
import { eventRemainingLabel, eventSessionBounds, formatTime, isHappeningNow } from "@/lib/date-utils";
import { useDatebookStore } from "@/lib/store";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Category, Item } from "@/lib/types";

export function UpNextCard({ item, category }: { item: Item; category: Category | undefined }) {
  return <UpNextFace item={item} category={category} />;
}

export function UpNextStack({
  happening,
  upcoming,
  categoryOf,
}: {
  happening: Item[];
  upcoming?: Item;
  categoryOf: (item: Item) => Category | undefined;
}) {
  const items = happening.length > 0 ? happening : upcoming ? [upcoming] : [];
  const live = happening.length > 0;
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const dragged = useRef(false);

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

  if (items.length === 0) return null;
  const safeIndex = Math.min(index, items.length - 1);
  const current = items[safeIndex];

  function go(dir: -1 | 1) {
    if (items.length < 2) return;
    haptic("light");
    setIndex((i) => (i + dir + items.length) % items.length);
  }

  return (
    <div>
      <AnimatePresence initial={false} mode="wait">
        {expanded && items.length > 1 ? (
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
                Happening now · {items.length}
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
              <UpNextFace key={item.id} item={item} category={categoryOf(item)} />
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
              className="relative"
              onPointerUp={() => {
                if (dragged.current) {
                  dragged.current = false;
                  return;
                }
                if (items.length > 1) {
                  haptic("light");
                  setExpanded(true);
                }
              }}
            >
              <AnimatePresence initial={false} mode="wait" custom={safeIndex}>
                <motion.div
                  key={current.id}
                  custom={safeIndex}
                  drag={items.length > 1 ? "x" : false}
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.16}
                  onDragStart={() => {
                    dragged.current = true;
                  }}
                  onDragEnd={(_, info) => {
                    if (info.offset.x < -48 || info.velocity.x < -400) go(1);
                    else if (info.offset.x > 48 || info.velocity.x > 400) go(-1);
                    window.setTimeout(() => {
                      dragged.current = false;
                    }, 40);
                  }}
                  initial={{ opacity: 0, x: 18 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -18 }}
                  transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
                >
                  <UpNextFace
                    item={current}
                    category={categoryOf(current)}
                    interactive={false}
                    forceLive={live}
                  />
                </motion.div>
              </AnimatePresence>
            </div>
            {items.length > 1 && (
              <div className="mt-2 flex items-center justify-center gap-1.5">
                {items.map((item, i) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={`Show ${item.title}`}
                    onClick={() => setIndex(i)}
                    className={cn(
                      "h-1.5 rounded-full transition-[width,background] duration-200",
                      i === safeIndex ? "w-4 bg-accent" : "w-1.5 bg-line-strong"
                    )}
                  />
                ))}
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
  forceLive,
}: {
  item: Item;
  category: Category | undefined;
  interactive?: boolean;
  forceLive?: boolean;
}) {
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
  const started = forceLive ?? isHappeningNow(item, now);
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

  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-surface p-5",
        interactive && "cursor-default"
      )}
    >
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
        {started && <span aria-hidden className="live-dot h-1.5 w-1.5 rounded-full bg-accent" />}
        {started ? "Happening now" : "Up next"}
      </p>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <h3 className="line-clamp-2 break-words text-[17px] font-semibold text-ink">{item.title}</h3>
        <span className="shrink-0 text-[12px] tabular-nums text-ink-soft" suppressHydrationWarning>
          {!started
            ? formatDistanceToNowStrict(start, { addSuffix: false })
            : item.allDay
              ? remaining
              : null}
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
