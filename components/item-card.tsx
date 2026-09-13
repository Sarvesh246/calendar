"use client";

import { memo, useDeferredValue, useEffect, useRef, useState } from "react";
import { useMediaQuery } from "@/lib/use-media-query";
import { MobileItemSheet, MobileTaskActions } from "@/components/mobile-item-sheet";
import { changeMobileStatus } from "@/lib/mobile-item-actions";
import { MobileQuickActions } from "@/components/mobile-quick-actions";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarClock, Check, ChevronDown, MapPin, MoreHorizontal, PanelRightOpen } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { registerItemExpander } from "@/lib/item-focus";
import { dayKey } from "@/lib/date-utils";
import { handleItemMenuKey, itemMenuProps, openItemMenuAt } from "@/lib/item-menu";
import {
  eventRemainingLabel,
  formatTime,
  isEventEnded,
  itemOccupiesDay,
  isOverdue,
} from "@/lib/date-utils";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens, prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { ItemCardChrome } from "@/lib/card-chrome";
import type { Category, Item, ItemStatus } from "@/lib/types";

const ItemEditor = dynamic(
  () => import("@/components/item-editor").then((m) => ({ default: m.ItemEditor })),
  { ssr: false, loading: () => (
    <div role="status" className="mt-3 space-y-3 border-t border-line pt-3">
      <span className="sr-only">Loading item details…</span>
      {[0, 1, 2].map((i) => <div key={i} aria-hidden className="h-9 animate-pulse rounded-md bg-surface-sunken" />)}
    </div>
  ) }
);

export type { ItemCardChrome };

/**
 * Leaving a list — deleted, filtered out, or hidden by "hide completed".
 * Height collapse is CSS grid `0fr`/`1fr` (see `.item-card-presence`); Framer
 * only fades so it never measures `height: auto` across the list.
 */
const CARD_EXIT = {
  opacity: 0,
  gridTemplateRows: "0fr",
  transition: { duration: motionTokens.exit, ease: motionTokens.easeIn },
};

export const ItemCard = memo(function ItemCard({
  item,
  category,
  day,
  clock24h,
  showLocation,
  showCategoryDot,
}: {
  item: Item;
  category: Category | undefined;
  day?: Date;
} & ItemCardChrome) {
  return item.type === "event" ? (
    <EventCard
      item={item}
      category={category}
      day={day}
      clock24h={clock24h}
      showLocation={showLocation}
    />
  ) : (
    <AssignmentCard
      item={item}
      category={category}
      clock24h={clock24h}
      showCategoryDot={showCategoryDot}
    />
  );
});

/* ------------------------------------------------------------------ */
/* Status controls                                                     */
/* ------------------------------------------------------------------ */

function CompleteButton({
  status,
  color,
  onToggle,
}: {
  status: ItemStatus;
  color: string;
  onToggle: () => void;
}) {
  const done = status === "done";
  const prevDone = useRef(done);
  const [burst, setBurst] = useState(0);

  useEffect(() => {
    if (done && !prevDone.current) setBurst((n) => n + 1);
    prevDone.current = done;
  }, [done]);

  return (
    <button
      type="button"
      onKeyDown={e => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        haptic(done ? "light" : "success");
        onToggle();
      }}
      aria-label={done ? "Mark to do" : "Mark complete"}
      title={done ? "Mark to do" : "Mark complete"}
      style={{ "--cat": color } as React.CSSProperties}
      className="press-none group/status flex h-11 w-11 shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
    >
      <span className="relative flex h-5 w-5 items-center justify-center">
        {burst > 0 && (
          <span
            key={burst}
            aria-hidden
            className="complete-ripple pointer-events-none absolute inset-0 rounded-full border-2 border-good"
          />
        )}
        <motion.span
          whileTap={{ scale: 0.82 }}
          transition={motionTokens.springSnappy}
          className={cn(
            "relative flex h-5 w-5 items-center justify-center rounded-full border-2",
            "transition-[background-color,border-color] duration-[var(--motion-standard)] ease-[var(--ease-standard)]",
            status === "todo" &&
              "border-[color-mix(in_srgb,var(--cat)_55%,transparent)] bg-transparent group-hover/status:border-[color-mix(in_srgb,var(--cat)_90%,transparent)]",
            status === "doing" &&
              "status-doing-ring border-2 border-accent bg-accent-soft",
            status === "done" && "border-good bg-good"
          )}
        >
          <AnimatePresence initial={false}>
            {status === "done" && (
              <motion.span
                key="check"
                initial={{ scale: 0, opacity: 0, rotate: -25 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={motionTokens.springSnappy}
                className="flex items-center justify-center"
              >
                <Check className="h-3 w-3 text-[var(--accent-ink)]" strokeWidth={3.25} />
              </motion.span>
            )}
          </AnimatePresence>
        </motion.span>
      </span>
    </button>
  );
}

export function StatusSegmented({
  value,
  onChange,
  layoutScope,
}: {
  value: ItemStatus;
  onChange: (status: ItemStatus) => void;
  layoutScope: string;
}) {
  const options: { value: ItemStatus; label: string }[] = [
    { value: "todo", label: "To do" },
    { value: "doing", label: "In progress" },
    { value: "done", label: "Done" },
  ];

  return (
    <div
      className="flex w-full items-center gap-0.5 rounded-lg border border-line bg-surface-sunken p-0.5"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              haptic(opt.value === "done" ? "success" : "light");
              onChange(opt.value);
            }}
            aria-pressed={active}
            className={cn(
              "press-none relative min-h-9 flex-1 rounded-md px-2 text-[12px] font-medium",
              "transition-colors duration-[var(--motion-standard)]",
              active ? "text-accent-ink" : "text-ink-soft hover:text-ink"
            )}
          >
            {active && (
              <motion.span
                layoutId={`item-status-pill-${layoutScope}`}
                className="absolute inset-0 rounded-md bg-accent"
                transition={motionTokens.spring}
              />
            )}
            <span className="relative z-[1]">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function useExpandable(itemId: string) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => registerItemExpander(itemId, () => setExpanded(true)), [itemId]);

  const toggle = () => {
    haptic("light");
    setExpanded((v) => !v);
  };
  const collapse = () => setExpanded(false);
  const keyToggle = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
      return;
    }
    if (e.key === "Escape" && expanded) {
      e.preventDefault();
      e.stopPropagation();
      setExpanded(false);
    }
  };
  return { expanded, toggle, collapse, keyToggle };
}

function ExpandPanel({
  open,
  item,
  category,
  clock24h,
  onCollapse,
}: {
  open: boolean;
  item: Item;
  category: Category | undefined;
  clock24h: boolean;
  onCollapse: () => void;
}) {
  const mobile = useMediaQuery("(max-width: 767px)");
  const [editing, setEditing] = useState(false);
  // Mounting the editor is the expensive part of a tap. Opening off a deferred
  // value lets the click paint (chevron, border) first and the editor render
  // in an interruptible pass; closing stays immediate.
  const deferredOpen = useDeferredValue(open);
  const [loaded, setLoaded] = useState(open);
  if (open && deferredOpen && !loaded) setLoaded(true);

  useEffect(() => {
    if (open || !loaded) return;
    const delayMs = Math.round(motionTokens.standard * 1000);
    const t = window.setTimeout(() => setLoaded(false), delayMs);
    return () => window.clearTimeout(t);
  }, [open, loaded]);

  return (
    <div className={cn("item-card-expand", open && deferredOpen && "is-open")}>
      <div className="item-card-expand-inner">
        {loaded && mobile && <div className="mt-3 space-y-3 border-t border-line pt-3 text-[13px]" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
          {item.description && <p className="whitespace-pre-wrap break-words text-ink-soft">{item.description}</p>}
          {item.location && <p className="text-ink-soft">{item.location}</p>}
          {item.url && /^https?:\/\//i.test(item.url) && <a className="inline-flex min-h-11 items-center text-accent" href={item.url} target="_blank" rel="noopener noreferrer">Open link</a>}
          <button className="min-h-11 w-full rounded-lg border border-line text-accent" onClick={() => setEditing(true)}>Edit item</button>
          {editing && <MobileItemSheet title="Edit item" onClose={() => setEditing(false)}><ItemEditor item={item} category={category} clock24h={clock24h} StatusSegmented={StatusSegmented} onCollapse={() => setEditing(false)} /></MobileItemSheet>}
        </div>}
        {loaded && !mobile && (
          <ItemEditor
            item={item}
            category={category}
            clock24h={clock24h}
            StatusSegmented={StatusSegmented}
            onCollapse={onCollapse}
          />
        )}
      </div>
    </div>
  );
}

function useCompleteStyle(done: boolean) {
  const [styled, setStyled] = useState(done);
  if (!done && styled) setStyled(false);
  if (done && !styled && prefersReducedMotion()) setStyled(true);

  useEffect(() => {
    if (!done || prefersReducedMotion()) return;
    const delayMs = Math.round(motionTokens.standard * 1000);
    const t = window.setTimeout(() => setStyled(true), delayMs);
    return () => window.clearTimeout(t);
  }, [done]);

  return styled;
}

/**
 * Hover (or keyboard focus) reveals the same few actions the right-click menu
 * leads with: open the inspector, reschedule, and everything else.
 */
function CardQuickActions({ item, day }: { item: Item; day?: Date }) {
  const openInspector = useUIStore((s) => s.openInspector);
  const key = day ? dayKey(day) : undefined;
  const btn =
    "flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors duration-[var(--motion-micro)] hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div
      className={cn(
        "card-quick-actions pointer-events-none absolute right-6 top-1/2 z-[2] hidden -translate-y-1/2 items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 opacity-0 shadow-[0_4px_12px_-6px_rgb(0_0_0/0.25)] md:flex",
        "transition-opacity duration-[var(--motion-micro)]",
        "group-hover/card:pointer-events-auto group-hover/card:opacity-100 group-focus-within/card:pointer-events-auto group-focus-within/card:opacity-100"
      )}
      onClick={stop}
      onKeyDown={stop}
    >
      <button type="button" className={btn} aria-label="Open details" title="Open details" onClick={() => openInspector(item.id)}>
        <PanelRightOpen className="h-3.5 w-3.5" strokeWidth={1.9} />
      </button>
      <button
        type="button"
        className={btn}
        aria-label="Reschedule"
        title="Reschedule"
        aria-haspopup="menu"
        onClick={(e) => openItemMenuAt(e.currentTarget, item.id, { dayKey: key, section: "reschedule" })}
      >
        <CalendarClock className="h-3.5 w-3.5" strokeWidth={1.9} />
      </button>
      <button
        type="button"
        className={btn}
        aria-label="More actions"
        title="More actions"
        aria-haspopup="menu"
        onClick={(e) => openItemMenuAt(e.currentTarget, item.id, { dayKey: key })}
      >
        <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.9} />
      </button>
    </div>
  );
}

function ExpandChevron({ expanded }: { expanded: boolean }) {
  return (
    <motion.span
      aria-hidden
      animate={{ rotate: expanded ? 180 : 0 }}
      transition={motionTokens.spring}
      className="flex h-4 w-4 shrink-0 items-center justify-center text-ink-faint"
    >
      <ChevronDown className="h-4 w-4" strokeWidth={1.9} />
    </motion.span>
  );
}

function CollapsedDescription({ show, text }: { show: boolean; text?: string }) {
  if (!text) return null;
  return (
    <div className={cn("item-card-expand", show && "is-open")}>
      <div className="item-card-expand-inner">
        <p className="mt-1 overflow-hidden whitespace-pre-line text-[11.5px] leading-snug text-ink-faint line-clamp-2">
          {text}
        </p>
      </div>
    </div>
  );
}

function CardFrame({
  dimmed,
  children,
  ...rest
}: {
  dimmed: boolean;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <motion.div
      className="item-card-presence"
      initial={false}
      style={{ gridTemplateRows: "1fr" }}
      exit={CARD_EXIT}
    >
      <div className="item-card-presence-inner">
        <div
          {...rest}
          className={cn(
            "item-card group/card press-none press-surface shrink-0 cursor-pointer overflow-hidden rounded-lg border border-line",
            "transition-[opacity,border-color,background-color] duration-[var(--motion-standard)]",
            dimmed && "opacity-[0.62]",
            rest.className
          )}
        >
          {children}
        </div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Event                                                               */
/* ------------------------------------------------------------------ */

function useEventPhase(item: Item, day?: Date) {
  const [, setTick] = useState(0);
  const now = new Date();
  const remaining = eventRemainingLabel(item, now);
  const ended = isEventEnded(item, now, day);
  const watchDay = day ?? now;
  const sameLocalDay =
    watchDay.getFullYear() === now.getFullYear() &&
    watchDay.getMonth() === now.getMonth() &&
    watchDay.getDate() === now.getDate();
  const live = Boolean(remaining) || (!ended && sameLocalDay && itemOccupiesDay(item, watchDay));
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, [live, item.id]);
  return { remaining, ended };
}

function EventCard({
  item,
  category,
  day,
  clock24h,
  showLocation,
}: {
  item: Item;
  category: Category | undefined;
  day?: Date;
  clock24h: boolean;
  showLocation: boolean;
}) {
  const color = category?.color ?? "#8a8a94";
  const { expanded, toggle, collapse, keyToggle } = useExpandable(item.id);
  const { remaining, ended } = useEventPhase(item, day);
  const showCompleteStyle = useCompleteStyle(ended);

  return (
    <CardFrame
      dimmed={showCompleteStyle}
      style={{ "--cat": color } as React.CSSProperties}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      // Named explicitly, because a `role="button"` with no label takes its
      // name from everything inside it — which, now that the card carries its
      // own action buttons, meant a screen reader announced "Physics Lecture
      // Start working on this Reschedule" as the name of one control.
      aria-label={`${item.title}${ended ? ", ended" : ""}. Show details`}
      onClick={toggle}
      onKeyDown={(e) => {
        if (!handleItemMenuKey(e, item.id, day ? dayKey(day) : undefined)) keyToggle(e);
      }}
      {...itemMenuProps(item.id, day ? dayKey(day) : undefined)}
      className={cn(
        "cat-surface px-[var(--card-pad-x)] py-[var(--card-pad-y)]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        expanded && "border-line-strong"
      )}
    >
      <div className="relative flex items-center gap-3">
        <div className="flex w-[74px] shrink-0 flex-col leading-tight">
          <span
            className={cn(
              "text-[13px] font-semibold tabular-nums",
              showCompleteStyle ? "text-ink-soft" : "cat-text"
            )}
          >
            {item.allDay ? "All day" : formatTime(item.at, clock24h)}
          </span>
          {!item.allDay && item.endAt && (
            <span className="text-[11px] tabular-nums text-ink-faint">
              {formatTime(item.endAt, clock24h)}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "relative line-clamp-2 w-fit max-w-full break-words text-[14px] font-medium",
              "transition-colors duration-[var(--motion-standard)]",
              showCompleteStyle ? "text-ink-soft" : "text-ink"
            )}
          >
            {item.title}
            <motion.span
              aria-hidden
              initial={false}
              animate={{ scaleX: showCompleteStyle ? 1 : 0 }}
              transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
              style={{ transformOrigin: "left center" }}
              className="pointer-events-none absolute inset-x-0 top-1/2 h-[1.5px] rounded-full bg-current"
            />
          </p>
          {remaining && !ended && (
            <p className="mt-0.5 text-[12px] tabular-nums text-ink-soft" suppressHydrationWarning>
              {remaining}
            </p>
          )}
          {ended && (
            <p className="mt-0.5 text-[12px] text-ink-soft" suppressHydrationWarning>
              ended
            </p>
          )}
          {showLocation && item.location && (
            <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-ink-soft">
              <MapPin className="h-3 w-3 shrink-0" strokeWidth={1.75} />
              {item.location}
            </p>
          )}
          <CollapsedDescription show={!expanded} text={item.description} />
        </div>
        {ended && (
          <span
            aria-hidden
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-good"
          >
            <Check className="h-3 w-3 text-[var(--accent-ink)]" strokeWidth={3.25} />
          </span>
        )}
        <CardQuickActions item={item} day={day} />
        <ExpandChevron expanded={expanded} />
      </div>

      <ExpandPanel
        open={expanded}
        item={item}
        category={category}
        clock24h={clock24h}
        onCollapse={collapse}
      />
    </CardFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Assignment / task                                                   */
/* ------------------------------------------------------------------ */

function AssignmentCard({
  item,
  category,
  clock24h,
  showCategoryDot,
}: {
  item: Item;
  category: Category | undefined;
  clock24h: boolean;
  showCategoryDot: boolean;
}) {
  const mobile = useMediaQuery("(max-width: 767px)");
  const [actions, setActions] = useState<"status" | "reschedule" | "edit" | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const toggleItemDone = useDatebookStore((s) => s.toggleItemDone);
  const color = category?.color ?? "#8a8a94";
  const status = item.status ?? "todo";
  const done = status === "done";
  const overdue = isOverdue(item);
  const showCompleteStyle = useCompleteStyle(done);
  const { expanded, toggle, collapse, keyToggle } = useExpandable(item.id);

  return (
    <CardFrame
      dimmed={showCompleteStyle}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      // See the event card above: without this the card's name absorbs the
      // labels of the quick actions sitting inside it.
      aria-label={`${item.title}. ${done ? "Done" : status === "doing" ? "In progress" : overdue ? "Overdue" : "To do"}. Show details`}
      onTouchStart={e => { if (!mobile || (e.target as HTMLElement).closest("button, a, input, select, textarea")) return; const t = e.touches[0]; touchStart.current = { x: t.clientX, y: t.clientY }; }}
      style={mobile ? { touchAction: "pan-y", transform: `translateX(${swipeOffset}px)` } : undefined}
      onTouchMove={e => { const start = touchStart.current; if (!start || expanded) return; const t = e.touches[0]; const dx = t.clientX - start.x; const dy = t.clientY - start.y; if (Math.abs(dy) > Math.abs(dx)) { touchStart.current = null; setSwipeOffset(0); return; } setSwipeOffset(Math.max(-36, Math.min(36, dx / 3))); }}
      onTouchCancel={() => { touchStart.current = null; setSwipeOffset(0); }}
      onTouchEnd={e => {
        setSwipeOffset(0);
        const start = touchStart.current; touchStart.current = null;
        if (!start || !mobile || expanded) return;
        const t = e.changedTouches[0]; const dx = t.clientX - start.x; const dy = t.clientY - start.y;
        if (Math.abs(dx) < 75 || Math.abs(dx) < Math.abs(dy) * 2) return;
        swiped.current = true;
        window.setTimeout(() => { swiped.current = false; }, 400);
        if (dx < 0) setActions("reschedule"); else changeMobileStatus(item, status === "doing" ? "done" : "doing");
      }}
      onClick={() => { if (!swiped.current) toggle(); }}
      onKeyDown={(e) => {
        if (!handleItemMenuKey(e, item.id)) keyToggle(e);
      }}
      {...itemMenuProps(item.id)}
      className={cn(
        "bg-surface px-[var(--card-pad-x)] py-[var(--card-pad-y)]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        expanded && "border-line-strong",
        overdue && !done && "bg-warn-soft/35",
        status === "doing" && !done && "bg-accent-soft/30"
      )}
    >
      <div className="relative flex items-center gap-1">
        <CompleteButton status={status} color={color} onToggle={() => mobile ? changeMobileStatus(item, done ? "todo" : "done") : toggleItemDone(item.id)} />

        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "relative line-clamp-2 w-fit max-w-full break-words text-[14px] font-medium",
              "transition-colors duration-[var(--motion-standard)]",
              showCompleteStyle ? "text-ink-soft" : "text-ink"
            )}
          >
            {item.title}
            <motion.span
              aria-hidden
              initial={false}
              animate={{ scaleX: showCompleteStyle ? 1 : 0 }}
              transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
              style={{ transformOrigin: "left center" }}
              className="pointer-events-none absolute inset-x-0 top-1/2 h-[1.5px] rounded-full bg-current"
            />
          </p>
          <p
            className={cn(
              "mt-0.5 truncate text-[12px] transition-colors duration-[var(--motion-standard)]",
              overdue && !done ? "font-medium text-warn" : "text-ink-soft"
            )}
          >
            {item.allDay ? "All day" : formatTime(item.at, clock24h)}
            {overdue && !done && " · overdue"}
            {status === "doing" && !overdue && " · in progress"}
            {done && " · done"}
          </p>
          <CollapsedDescription show={!expanded} text={item.description} />
        </div>

        {showCategoryDot && (
          <span
            aria-hidden
            style={{ "--cat": color } as React.CSSProperties}
            className={cn(
              "cat-dot h-1.5 w-1.5 shrink-0 rounded-full transition-[opacity,transform] duration-[var(--motion-micro)]",
              expanded && "scale-50 opacity-0"
            )}
          />
        )}
        {/* Named controls for exactly what the swipes do, so the swipes are a
            shortcut rather than the only route. */}
        {mobile && (
          <MobileQuickActions item={item} onReschedule={() => setActions("reschedule")} />
        )}
        <CardQuickActions item={item} />
        <ExpandChevron expanded={expanded} />
      </div>

      {mobile && actions && actions !== "edit" && <MobileTaskActions item={item} initialReschedule={actions === "reschedule"} onClose={() => setActions(null)} onEdit={() => setActions("edit")} />}
      {mobile && actions === "edit" && <MobileItemSheet title="Edit item" onClose={() => setActions(null)}><ItemEditor item={item} category={category} clock24h={clock24h} StatusSegmented={StatusSegmented} onCollapse={() => setActions(null)} /></MobileItemSheet>}
      <ExpandPanel
        open={expanded}
        item={item}
        category={category}
        clock24h={clock24h}
        onCollapse={collapse}
      />
    </CardFrame>
  );
}
