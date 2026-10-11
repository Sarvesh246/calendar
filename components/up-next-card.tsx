"use client";

import { collapseTiming } from "@/lib/use-animated-collapse";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useTransform, type MotionValue } from "framer-motion";
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
import { motion as motionTokens, prefersReducedMotion, releaseSpring } from "@/lib/motion";
import { VelocityTracker, project, rubberband } from "@/lib/gesture";
import { NumberRoll } from "@/components/ui/number-roll";
import { cn } from "@/lib/utils";
import type { Category, Item } from "@/lib/types";
import { itemDisplayTitle, classLabel } from "@/lib/course-label";

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
  /** How the last change happened, so the leaving and arriving cards move the right way. */
  const [change, setChange] = useState<DeckChange>({ dir: 1, velocity: 0, thrown: false });
  const stackRef = useRef<HTMLDivElement>(null);
  // One position per card, so a thrown card can keep flying on its own value
  // while the next one rises underneath it.
  const positions = useRef(new Map<string, MotionValue<number>>());
  const wheel = useRef({ tracker: new VelocityTracker(), timer: 0, lockedUntil: 0, last: 0 });

  const count = items.length;
  const safeIndex = count === 0 ? 0 : Math.min(index, count - 1);
  const current = count === 0 ? null : items[safeIndex];

  /** Each mounted card registers its own position (see DeckCard). */
  const positionOf = (id: string) => positions.current.get(id);
  const register = (id: string, x: MotionValue<number> | null) => {
    if (x) positions.current.set(id, x);
    else positions.current.delete(id);
  };

  /** Move to the next (dir 1) or previous (dir -1) card. */
  const go = (dir: -1 | 1, how: { velocity?: number; thrown?: boolean } = {}) => {
    if (count < 2) return;
    haptic("selection");
    setChange({ dir, velocity: how.velocity ?? 0, thrown: Boolean(how.thrown) });
    setIndex((i) => {
      const cur = Math.min(i, count - 1);
      return (cur + dir + count) % count;
    });
  };

  /**
   * A released card — by finger or by trackpad — goes where it would coast
   * to: far enough and it is thrown off (carrying its speed) while the next
   * card rises from the stack; otherwise it springs back to the middle.
   */
  const release = (id: string, velocity: number) => {
    const x = positionOf(id);
    if (!x) return;
    const at = x.get();
    const projected = project(at, velocity);
    if (count > 1 && Math.abs(projected) > THROW_DISTANCE && Math.sign(projected) === Math.sign(at || projected)) {
      go(projected < 0 ? 1 : -1, { velocity, thrown: true });
      return;
    }
    void animate(x, 0, releaseSpring(velocity, 0.78, 0.36));
  };

  // Two-finger trackpad swipes drive the card the same way a finger does:
  // the wheel deltas move it, and when they stop it is released.
  const releaseRef = useRef(release);
  useEffect(() => {
    releaseRef.current = release;
  });
  useEffect(() => {
    const el = stackRef.current;
    if (!el || count < 2 || !current) return;
    const id = current.id;
    const state = wheel.current;
    const onWheel = (e: WheelEvent) => {
      if (expanded) return;
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      // Momentum events keep arriving after a throw; let them die out.
      if (e.timeStamp < state.lockedUntil) return;
      const x = positionOf(id);
      if (!x) return;
      if (state.timer === 0) {
        x.stop();
        state.tracker.reset(x.get(), e.timeStamp);
      }
      const next = rubberband(x.get() - e.deltaX, 400, 0.9);
      x.set(next);
      state.tracker.add(next, e.timeStamp);
      state.last = e.timeStamp;
      window.clearTimeout(state.timer);
      const finish = () => {
        state.timer = 0;
        releaseRef.current(id, state.tracker.velocity(state.last));
      };
      if (Math.abs(next) > THROW_DISTANCE) {
        state.lockedUntil = e.timeStamp + 450;
        finish();
        return;
      }
      state.timer = window.setTimeout(finish, 90);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.clearTimeout(state.timer);
      state.timer = 0;
    };
    // positionOf is a stable lookup into a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, expanded, current?.id]);

  // Show all / Show one changes how tall the deck is. The container springs
  // between the two heights so the day below glides instead of jumping by the
  // difference in one frame. (The outgoing view is popped out of flow, so the
  // container's natural height is already the incoming one's.)
  const shellRef = useRef<HTMLDivElement>(null);
  const shellHeight = useRef(0);
  const hasDeck = count > 0;
  useLayoutEffect(() => {
    const el = shellRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    shellHeight.current = el.offsetHeight;
    const ro = new ResizeObserver(() => {
      if (el.getAnimations().length === 0) shellHeight.current = el.offsetHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasDeck]);
  const shownExpanded = useRef(expanded);
  useLayoutEffect(() => {
    if (shownExpanded.current === expanded) return;
    shownExpanded.current = expanded;
    const el = shellRef.current;
    if (!el || prefersReducedMotion()) return;
    const from = shellHeight.current;
    const to = el.offsetHeight;
    if (Math.abs(to - from) < 1) return;
    el.getAnimations().forEach((a) => a.cancel());
    el.style.overflow = "clip";
    const { easing, duration } = collapseTiming();
    const anim = el.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration, easing });
    anim.finished.then(
      () => {
        el.style.overflow = "";
        shellHeight.current = el.offsetHeight;
      },
      () => {}
    );
  }, [expanded]);

  if (count === 0 || !current) return null;

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

  const reduce = prefersReducedMotion();

  return (
    <div ref={shellRef} data-page-swipe="off">
      <AnimatePresence initial={false} mode="popLayout">
        {expanded && count > 1 ? (
          <motion.div
            key="list"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: motionTokens.exit } }}
            transition={{ opacity: { duration: motionTokens.standard }, y: motionTokens.nudge }}
            className="flex flex-col gap-2"
          >
            <div className="flex items-center justify-between px-0.5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">
                {stackLabel} · {count}
              </p>
              <button
                type="button"
                onClick={() => {
                  haptic("light");
                  setExpanded(false);
                }}
                className="text-[12px] font-medium text-ink-soft hover:text-ink"
              >
                Show one
              </button>
            </div>
            {/* The stack fans out: each card drops from where the deck sat,
                a beat after the one above it. */}
            {items.map((item, i) => (
              <motion.div
                key={item.id}
                initial={reduce ? false : { opacity: 0, y: -18 * Math.min(i, 3), scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ ...motionTokens.nudge, delay: Math.min(i, 5) * 0.035 }}
              >
                <UpNextFace item={item} category={categoryOf(item)} mode={modeOf(item)} />
              </motion.div>
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="pager"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: motionTokens.exit } }}
            transition={{ opacity: { duration: motionTokens.standard }, y: motionTokens.nudge }}
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
              <AnimatePresence initial={false} mode="popLayout" custom={change}>
                <DeckCard
                  key={current.id}
                  id={current.id}
                  change={change}
                  onRegister={register}
                  draggable={count > 1 && !reduce}
                  label={
                    count > 1
                      ? `${stackLabel}, ${safeIndex + 1} of ${count}. Swipe or drag to switch.`
                      : undefined
                  }
                  onRelease={(velocity) => release(current.id, velocity)}
                >
                  <UpNextFace item={current} category={categoryOf(current)} mode={modeOf(current)} />
                </DeckCard>
              </AnimatePresence>
            </div>
            {count > 1 && (
              <div className="mt-2.5 flex items-center justify-center gap-3">
                <p className="text-[11px] tabular-nums text-ink-faint">
                  <NumberRoll value={safeIndex + 1} /> of {count}
                </p>
                <div className="flex items-center gap-1.5">
                  {items.map((item, i) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-label={`Show ${itemDisplayTitle(item)}`}
                      aria-current={i === safeIndex ? "true" : undefined}
                      onClick={() => {
                        if (i === safeIndex) return;
                        haptic("selection");
                        setChange({ dir: i > safeIndex ? 1 : -1, velocity: 0, thrown: false });
                        setIndex(i);
                      }}
                      className={cn(
                        "h-1.5 rounded-full transition-[width,background-color] duration-[var(--spring-nudge-ms)] ease-[var(--spring-nudge)]",
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

/** How far (projected, px) a card has to be heading to be thrown off the deck. */
const THROW_DISTANCE = 96;

interface DeckChange {
  /** 1 = moved to the next card (thrown left), -1 = previous. */
  dir: 1 | -1;
  velocity: number;
  thrown: boolean;
}

const deckVariants = {
  // A card arriving after a throw rises from the stack beneath; one arriving
  // from a button or key slides in from the side the deck moved toward.
  enter: (c: DeckChange) =>
    c.thrown
      ? { opacity: 0.4, scale: 0.94, y: 10, x: 0, rotate: 0 }
      : { opacity: 0, scale: 1, y: 0, x: c.dir * 36, rotate: 0 },
  center: {
    opacity: 1,
    scale: 1,
    y: 0,
    x: 0,
    rotate: 0,
    transition: { ...motionTokens.nudge, opacity: { duration: 0.16 } },
  },
  // A thrown card keeps flying at the speed it left the finger; one sent
  // away by a button slips out the other side.
  exit: (c: DeckChange) =>
    c.thrown
      ? {
          x: -c.dir * 520,
          zIndex: 20,
          transition: { x: releaseSpring(c.velocity, 1, 0.34) },
        }
      : {
          x: -c.dir * 36,
          opacity: 0,
          zIndex: 20,
          transition: { duration: motionTokens.exit, ease: motionTokens.ease },
        },
};

// `ref` is forwarded so AnimatePresence's popLayout can measure the card it
// lifts out of the flow while it flies away.
function DeckCard({
  ref,
  id,
  change,
  onRegister,
  draggable,
  label,
  onRelease,
  children,
}: {
  ref?: React.Ref<HTMLDivElement>;
  id: string;
  change: DeckChange;
  onRegister: (id: string, x: MotionValue<number> | null) => void;
  draggable: boolean;
  label?: string;
  onRelease: (velocity: number) => void;
  children: React.ReactNode;
}) {
  // Its own position, so a thrown card keeps flying on it while the next one
  // rises underneath; the stack drives it (wheel, release) through the registry.
  const x = useMotionValue(0);
  const register = useRef(onRegister);
  useEffect(() => {
    register.current(id, x);
    const unregister = register.current;
    return () => unregister(id, null);
  }, [id, x]);
  // A card under the finger tilts with it, like one held at the bottom edge.
  const rotate = useTransform(x, [-320, 0, 320], [-7, 0, 7]);
  return (
    <motion.div
      ref={ref}
      custom={change}
      variants={deckVariants}
      initial="enter"
      animate="center"
      exit="exit"
      className="relative z-10 cursor-grab active:cursor-grabbing shadow-[0_16px_32px_-24px_rgba(0,0,0,0.45)]"
      style={{ x, rotate, touchAction: "pan-y", transformOrigin: "50% 120%" }}
      tabIndex={label ? 0 : undefined}
      role={label ? "group" : undefined}
      aria-label={label}
      drag={draggable ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      // 1 = no resistance: the card stays exactly under the finger.
      dragElastic={1}
      dragMomentum={false}
      onDragEnd={(_, info) => onRelease(info.velocity.x)}
    >
      {children}
    </motion.div>
  );
}

function UpNextFace({
  item,
  category,
  mode,
}: {
  item: Item;
  category: Category | undefined;
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
    <div className="rounded-lg border border-line bg-surface p-5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
        {started && <span aria-hidden className="live-dot h-1.5 w-1.5 rounded-full bg-accent" />}
        {eyebrow}
      </p>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <h3 className="line-clamp-2 break-words text-[17px] font-semibold text-ink">{itemDisplayTitle(item, category)}</h3>
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
            {classLabel(category)}
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
