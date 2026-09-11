"use client";

import { memo, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, MapPin } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { registerItemExpander } from "@/lib/item-focus";
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

function StatusSegmented({
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
  const [loaded, setLoaded] = useState(open);
  if (open && !loaded) setLoaded(true);

  useEffect(() => {
    if (open || !loaded) return;
    const delayMs = Math.round(motionTokens.standard * 1000);
    const t = window.setTimeout(() => setLoaded(false), delayMs);
    return () => window.clearTimeout(t);
  }, [open, loaded]);

  return (
    <div className={cn("item-card-expand", open && "is-open")}>
      <div className="item-card-expand-inner">
        {loaded && (
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
            "item-card press-none press-surface shrink-0 cursor-pointer overflow-hidden rounded-lg border border-line",
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
      onClick={toggle}
      onKeyDown={keyToggle}
      className={cn(
        "cat-surface px-[var(--card-pad-x)] py-[var(--card-pad-y)]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        expanded && "border-line-strong"
      )}
    >
      <div className="flex items-center gap-3">
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
      onClick={toggle}
      onKeyDown={keyToggle}
      className={cn(
        "bg-surface px-[var(--card-pad-x)] py-[var(--card-pad-y)]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        expanded && "border-line-strong",
        overdue && !done && "bg-warn-soft/35",
        status === "doing" && !done && "bg-accent-soft/30"
      )}
    >
      <div className="flex items-center gap-1">
        <CompleteButton status={status} color={color} onToggle={() => toggleItemDone(item.id)} />

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
