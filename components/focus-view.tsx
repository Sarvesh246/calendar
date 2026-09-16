"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Infinity as InfinityIcon, Pause, Play, Search, X } from "lucide-react";
import { useDatebookStore, useCategory } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import {
  eventRemainingLabel,
  focusQueue,
  formatTime,
  happeningNowStack,
  relativeDueLabel,
} from "@/lib/date-utils";
import { classCountdownWindowMs } from "@/lib/class-reminder";
import { useFilteredItems } from "@/lib/use-filtered-items";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens, prefersReducedMotion } from "@/lib/motion";
import { notificationPermission } from "@/lib/reminders";
import { setStatusWithUndo } from "@/lib/item-actions";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MobileItemSheet } from "@/components/mobile-item-sheet";
import {
  clockFace,
  formatClockFace,
  formatFocusClock,
  isRunning,
  isSessionLive,
  sessionElapsedMs,
  timedItemCount,
  rankFocusItems,
  nextAfterComplete,
  type ClockFace,
} from "@/lib/focus-session";
import { exitFocusRoom, useFocusSessionStore } from "@/lib/focus-session-store";
import type { Item } from "@/lib/types";

function useTick(enabled: boolean, ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [enabled, ms]);
  return now;
}

function pingTimeUp(title: string) {
  haptic("warn");
  if (notificationPermission() !== "granted") return;
  try {
    new Notification("Time’s up", { body: title, tag: "datebook-focus" });
  } catch {
    /* Safari without Notification in this context */
  }
}

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

export function FocusView() {
  const hydrate = useFocusSessionStore((s) => s.hydrate);
  const ensureSession = useFocusSessionStore((s) => s.ensureSession);
  const session = useFocusSessionStore((s) => s.session);
  const items = useFilteredItems();
  const allItems = useDatebookStore((s) => s.items);
  const categories = useDatebookStore((s) => s.categories);
  const desktop = useMediaQuery("(min-width: 768px)");

  useEffect(() => {
    hydrate();
    ensureSession(undefined, items, categories);
  }, [hydrate, ensureSession, items, categories]);

  const active =
    allItems.find((i) => i.id === session?.activeItemId) ??
    items.find((i) => i.id === session?.activeItemId);

  useEffect(() => {
    if (!session) return;
    if (session.activeItemId && !allItems.some((i) => i.id === session.activeItemId)) {
      const next = nextAfterComplete(items, session.activeItemId, new Date(), categories);
      useFocusSessionStore.getState().selectNext(next?.id ?? null);
    }
  }, [session, allItems, items, categories]);

  return (
    <FocusRoom
      items={items}
      active={active}
      desktop={desktop}
    />
  );
}

function FocusRoom({
  items,
  active,
  desktop,
}: {
  items: Item[];
  active: Item | undefined;
  desktop: boolean;
}) {
  const session = useFocusSessionStore((s) => s.session);
  const toggle = useFocusSessionStore((s) => s.toggle);
  const setDuration = useFocusSessionStore((s) => s.setDuration);
  const switchItem = useFocusSessionStore((s) => s.switchItem);
  const selectNext = useFocusSessionStore((s) => s.selectNext);
  const endSession = useFocusSessionStore((s) => s.endSession);
  const markOvertimeNotified = useFocusSessionStore((s) => s.markOvertimeNotified);
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const categories = useDatebookStore((s) => s.categories);
  const classReminderMinutes = useDatebookStore((s) => s.settings.classReminderMinutes);
  const category = useCategory(active?.categoryId);
  const running = session ? isRunning(session) : false;
  const now = useTick(true, 250);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const [celebrating, setCelebrating] = useState(false);

  const ranked = useMemo(() => rankFocusItems(items, new Date(now), categories), [items, now, categories]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ranked;
    return ranked.filter((i) => i.title.toLowerCase().includes(q));
  }, [ranked, query]);

  const suggested = useMemo(() => {
    const q = focusQueue(items, new Date(now), categories);
    return q.current?.id === active?.id ? q.next : q.current;
  }, [items, now, categories, active?.id]);

  const headsUp = useMemo(() => {
    const stack = happeningNowStack(
      items,
      new Date(now),
      categories,
      classCountdownWindowMs(classReminderMinutes)
    );
    return [...stack.happening, ...stack.startingSoon].filter((i) => i.id !== active?.id)[0];
  }, [items, now, categories, classReminderMinutes, active?.id]);

  const face: ClockFace | null = session ? clockFace(session, now) : null;
  const sessionMs = session ? sessionElapsedMs(session, now) : 0;
  const showSessionTotal = session ? timedItemCount(session, now) > 1 : false;
  const work = active && active.type !== "event";
  const eventWatch = active?.type === "event" ? eventRemainingLabel(active, new Date(now)) : undefined;

  useEffect(() => {
    if (!session || !active || !face) return;
    if (face.kind !== "overtime" || session.overtimeNotified) return;
    pingTimeUp(active.title);
    markOvertimeNotified();
  }, [session, active, face, markOvertimeNotified]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (useUIStore.getState().contextMenu || document.querySelector('[aria-modal="true"]')) return;
      const typing = isTypingTarget(e.target);
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      if (e.key === "Escape") {
        e.preventDefault();
        exitFocusRoom();
        return;
      }
      if (typing) return;

      if (key === " " && work) {
        e.preventDefault();
        toggle();
      } else if (key === "c" && work) {
        e.preventDefault();
        complete();
      } else if ((key === "/" || key === "s") && desktop) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (desktop && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        setHighlight((h) => {
          if (!filtered.length) return 0;
          const delta = e.key === "ArrowDown" ? 1 : -1;
          return (h + delta + filtered.length) % filtered.length;
        });
      } else if (desktop && e.key === "Enter" && filtered[highlight]) {
        e.preventDefault();
        pick(filtered[highlight]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // complete/pick close over latest active
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work, desktop, filtered, highlight, toggle]);

  function pick(item: Item) {
    haptic("light");
    switchItem(item.id);
    setSheetOpen(false);
  }

  function complete() {
    if (!active || active.type === "event" || celebrating) return;
    haptic("success");
    setCelebrating(true);
    window.setTimeout(() => {
      setStatusWithUndo(active, "done");
      const next = nextAfterComplete(items, active.id, new Date(), categories);
      selectNext(next?.id ?? null);
      setCelebrating(false);
    }, prefersReducedMotion() ? 0 : 280);
  }

  const stage = (
    <FocusStage
      active={active}
      categoryName={category?.name}
      categoryColor={category?.color}
      clock24h={clock24h}
      headsUp={headsUp}
      onHeadsUp={() => headsUp && pick(headsUp)}
      face={face}
      eventWatch={eventWatch}
      sessionMs={sessionMs}
      showSessionTotal={showSessionTotal}
      running={running}
      work={Boolean(work)}
      celebrating={celebrating}
      onToggle={() => {
        if (!work) return;
        haptic("light");
        toggle();
      }}
      onComplete={complete}
      duration={session?.clock === "countdown" && session.durationMs === 45 * 60_000 ? 45 : session?.clock === "countdown" ? 25 : "stopwatch"}
      onDuration={(preset) => {
        haptic("light");
        setDuration(preset);
      }}
      suggested={desktop ? undefined : suggested}
      onAdoptSuggested={() => suggested && pick(suggested)}
    />
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={motionTokens.tweenStandard}
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        desktop ? "md:min-h-[70vh]" : "items-stretch"
      )}
    >
      <button
        type="button"
        onClick={() => exitFocusRoom()}
        aria-label="Exit focus"
        className="fixed right-4 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[41] flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
      >
        <X className="h-4 w-4" strokeWidth={2} />
        Exit
      </button>

      {desktop ? (
        <div className="mx-auto grid w-full max-w-[1100px] flex-1 grid-cols-[minmax(0,1.4fr)_minmax(16rem,1fr)] gap-8 px-2 pt-8 pb-6">
          <div className="flex min-w-0 flex-col justify-center">{stage}</div>
          <FocusQueue
            items={filtered}
            activeId={active?.id}
            query={query}
            onQuery={setQuery}
            highlight={highlight}
            onHighlight={setHighlight}
            onPick={pick}
            searchRef={searchRef}
          />
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-8 px-4 pb-8 pt-16 text-center">
          {stage}
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="min-h-11 rounded-full border border-line bg-surface px-5 text-[13px] font-medium text-ink-soft"
          >
            Switch
          </button>
        </div>
      )}

      <div className={cn("flex justify-center pb-[max(0.5rem,env(safe-area-inset-bottom))]", desktop && "px-2")}>
        {isSessionLive(session, now) && (
          <button
            type="button"
            onClick={() => {
              haptic("light");
              endSession();
            }}
            className="text-[12.5px] font-medium text-ink-faint underline-offset-2 hover:text-ink-soft hover:underline"
          >
            End session
          </button>
        )}
      </div>

      {sheetOpen && (
        <MobileItemSheet title="Switch" onClose={() => setSheetOpen(false)}>
          <label className="mb-2 mt-1 flex min-h-11 items-center gap-2 rounded-lg border border-line px-3">
            <Search className="h-4 w-4 text-ink-faint" strokeWidth={1.9} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find an item"
              className="min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-faint focus:outline-none"
            />
          </label>
          <ul className="flex flex-col gap-0.5 pb-4">
            {filtered.map((item) => (
              <QueueRow
                key={item.id}
                item={item}
                active={item.id === active?.id}
                onPick={() => pick(item)}
              />
            ))}
            {filtered.length === 0 && (
              <li className="px-2 py-6 text-center text-[13px] text-ink-faint">Nothing matches.</li>
            )}
          </ul>
        </MobileItemSheet>
      )}
    </motion.div>
  );
}

function FocusStage({
  active,
  categoryName,
  categoryColor,
  clock24h,
  headsUp,
  onHeadsUp,
  face,
  eventWatch,
  sessionMs,
  showSessionTotal,
  running,
  work,
  celebrating,
  onToggle,
  onComplete,
  duration,
  onDuration,
  suggested,
  onAdoptSuggested,
}: {
  active: Item | undefined;
  categoryName?: string;
  categoryColor?: string;
  clock24h: boolean;
  headsUp?: Item;
  onHeadsUp: () => void;
  face: ClockFace | null;
  eventWatch?: string;
  sessionMs: number;
  showSessionTotal: boolean;
  running: boolean;
  work: boolean;
  celebrating: boolean;
  onToggle: () => void;
  onComplete: () => void;
  duration: "stopwatch" | 25 | 45;
  onDuration: (preset: "stopwatch" | 25 | 45) => void;
  suggested?: Item;
  onAdoptSuggested: () => void;
}) {
  if (!active) {
    return <p className="text-[28px] font-semibold text-ink-soft">Nothing left.</p>;
  }

  const due =
    active.type === "event"
      ? [active.allDay ? "All day" : formatTime(active.at, clock24h), eventWatch].filter(Boolean).join(" · ")
      : relativeDueLabel(active.at, { allDay: active.allDay });

  const display = active.type === "event" ? eventWatch ?? due : face ? formatClockFace(face) : "0:00";

  return (
    <div className="flex flex-col items-center gap-6 text-center md:items-start md:text-left">
      {headsUp && (
        <button
          type="button"
          onClick={onHeadsUp}
          className="w-full max-w-[28rem] rounded-xl border border-line bg-surface-sunken px-3 py-2 text-left text-[12.5px] text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
        >
          <span className="font-medium text-ink">Class heads-up</span>
          <span className="mt-0.5 block truncate">{headsUp.title}</span>
        </button>
      )}
      <motion.div
        key={active.id}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: celebrating ? 0.85 : 1, y: 0, scale: celebrating ? 0.98 : 1 }}
        transition={motionTokens.springGentle}
      >
        {categoryName && (
          <p
            className="cat-text text-[12px] font-medium uppercase tracking-wider"
            style={{ "--cat": categoryColor } as React.CSSProperties}
          >
            {categoryName}
          </p>
        )}
        <h1 className="mt-2 max-w-[22ch] text-[30px] font-semibold leading-tight text-ink sm:text-[36px]">
          {active.title}
        </h1>
        <p className="mt-2 text-[15px] text-ink-soft" suppressHydrationWarning>
          {due}
        </p>
      </motion.div>

      {work ? (
        <>
          <button
            type="button"
            onClick={onToggle}
            aria-label={running ? "Pause" : "Start"}
            className="font-semibold tabular-nums tracking-tight text-ink"
            style={{ fontSize: "clamp(3.25rem, 8vw, 5.25rem)", lineHeight: 1 }}
          >
            {display}
          </button>
          {showSessionTotal && (
            <p className="text-[13px] tabular-nums text-ink-faint">Session · {formatFocusClock(sessionMs)}</p>
          )}
          <div className="flex gap-1.5" role="group" aria-label="Timer length">
            <DurationChip label="∞" pressed={duration === "stopwatch"} onClick={() => onDuration("stopwatch")} />
            <DurationChip label="25" pressed={duration === 25} onClick={() => onDuration(25)} />
            <DurationChip label="45" pressed={duration === 45} onClick={() => onDuration(45)} />
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 md:justify-start">
            <Button variant="primary" onClick={onToggle} className="min-h-12 rounded-full px-6">
              {running ? <Pause className="h-4 w-4" strokeWidth={2.25} /> : <Play className="h-4 w-4" strokeWidth={2.25} />}
              {running ? "Pause" : "Start"}
            </Button>
            <Button variant="secondary" onClick={onComplete} disabled={celebrating} className="min-h-12 rounded-full px-6">
              <Check className="h-4 w-4" strokeWidth={2.5} />
              Done
            </Button>
          </div>
        </>
      ) : (
        <p className="text-[42px] font-semibold tabular-nums text-ink sm:text-[52px]">{display}</p>
      )}

      <AnimatePresence>
        {celebrating && (
          <motion.span
            key="celebrate"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1.4, opacity: 0 }}
            transition={{ duration: 0.32, ease: motionTokens.ease }}
            className="complete-ripple pointer-events-none mx-auto block h-12 w-12 rounded-full border-2 border-good"
          />
        )}
      </AnimatePresence>

      {suggested && (
        <button type="button" onClick={onAdoptSuggested} className="text-[13px] text-ink-faint hover:text-ink-soft">
          Suggested · {suggested.title}
        </button>
      )}
    </div>
  );
}

function DurationChip({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "flex h-9 min-w-9 items-center justify-center rounded-full px-3 text-[13px] font-medium tabular-nums",
        pressed ? "bg-ink text-surface" : "border border-line bg-surface text-ink-soft hover:text-ink"
      )}
    >
      {label === "∞" ? <InfinityIcon className="h-3.5 w-3.5" strokeWidth={2} /> : label}
    </button>
  );
}

function FocusQueue({
  items,
  activeId,
  query,
  onQuery,
  highlight,
  onHighlight,
  onPick,
  searchRef,
}: {
  items: Item[];
  activeId?: string;
  query: string;
  onQuery: (q: string) => void;
  highlight: number;
  onHighlight: (i: number) => void;
  onPick: (item: Item) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  useEffect(() => {
    searchRef.current?.focus();
  }, [searchRef]);

  return (
    <aside className="flex min-h-0 flex-col rounded-2xl border border-line bg-surface">
      <label className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
        <Search className="h-4 w-4 text-ink-faint" strokeWidth={1.9} />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => {
            onQuery(e.target.value);
            onHighlight(0);
          }}
          placeholder="Find an item"
          aria-keyshortcuts="S /"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-faint focus:outline-none"
        />
      </label>
      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
        {items.map((item, i) => (
          <QueueRow
            key={item.id}
            item={item}
            active={item.id === activeId}
            highlighted={i === highlight}
            onHover={() => onHighlight(i)}
            onPick={() => onPick(item)}
          />
        ))}
        {items.length === 0 && (
          <li className="px-3 py-8 text-center text-[13px] text-ink-faint">Nothing in this filter.</li>
        )}
      </ul>
    </aside>
  );
}

function QueueRow({
  item,
  active,
  highlighted,
  onHover,
  onPick,
}: {
  item: Item;
  active: boolean;
  highlighted?: boolean;
  onHover?: () => void;
  onPick: () => void;
}) {
  const category = useCategory(item.categoryId);
  const doing = item.type !== "event" && item.status === "doing";
  return (
    <li>
      <button
        type="button"
        onMouseEnter={onHover}
        onClick={onPick}
        className={cn(
          "flex w-full min-h-11 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left",
          active ? "bg-accent-soft" : highlighted ? "bg-surface-sunken" : "hover:bg-surface-sunken"
        )}
      >
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: category?.color ?? "#8a8a94" }}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-ink">{item.title}</span>
          <span className="block truncate text-[11.5px] text-ink-faint">
            {doing ? "In progress" : item.type === "event" ? "Event" : relativeDueLabel(item.at, { allDay: item.allDay })}
          </span>
        </span>
      </button>
    </li>
  );
}
