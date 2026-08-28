"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { format } from "date-fns";
import { AlignLeft, Bell, CalendarClock, Check, ChevronDown, ExternalLink, MapPin, Tag, Trash2 } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { formatTime, isOverdue } from "@/lib/date-utils";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Category, Item, ItemStatus } from "@/lib/types";

function useClock24h() {
  return useDatebookStore((s) => s.settings.clock24h);
}

export function ItemCard({ item, category }: { item: Item; category: Category | undefined }) {
  return item.type === "event" ? (
    <EventCard item={item} category={category} />
  ) : (
    <AssignmentCard item={item} category={category} />
  );
}

/* ------------------------------------------------------------------ */
/* Status controls                                                     */
/* ------------------------------------------------------------------ */

const STATUS_CYCLE: ItemStatus[] = ["todo", "doing", "done"];

const NEXT_ACTION: Record<ItemStatus, string> = {
  todo: "Mark in progress",
  doing: "Mark complete",
  done: "Mark to do",
};

function StatusCycleButton({
  status,
  color,
  onCycle,
}: {
  status: ItemStatus;
  color: string;
  onCycle: () => void;
}) {
  const prevStatus = useRef(status);
  const [checkBurst, setCheckBurst] = useState(false);

  useEffect(() => {
    if (status === "done" && prevStatus.current !== "done") {
      setCheckBurst(true);
    }
    prevStatus.current = status;
  }, [status]);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(status) + 1) % STATUS_CYCLE.length];
        haptic(next === "done" ? "success" : "light");
        onCycle();
      }}
      aria-label={NEXT_ACTION[status]}
      title={NEXT_ACTION[status]}
      style={{ "--cat": color } as React.CSSProperties}
      className="press-none flex h-11 w-11 shrink-0 items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
    >
      <span
        className={cn(
          "relative flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors",
          status === "todo" && "border-[color-mix(in_srgb,var(--cat)_55%,transparent)] bg-transparent",
          status === "doing" && "status-doing-ring border-accent bg-[conic-gradient(from_200deg,var(--accent)_0deg,var(--accent)_180deg,transparent_180deg)]",
          status === "done" && "border-good bg-good"
        )}
      >
        <AnimatePresence initial={false}>
          {status === "done" && (
            <motion.span
              key="check"
              initial={checkBurst ? { scale: 0, opacity: 0 } : false}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={motionTokens.springSnappy}
              onAnimationComplete={() => setCheckBurst(false)}
            >
              <Check className="h-3 w-3 text-white" strokeWidth={3} />
            </motion.span>
          )}
        </AnimatePresence>
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
            className={cn(
              "relative min-h-9 flex-1 rounded-md px-2 text-[12px] font-medium transition-colors",
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

/* ------------------------------------------------------------------ */
/* Shared expand/collapse detail panel                                 */
/* ------------------------------------------------------------------ */

function linkLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (/instructure\.com|canvas/.test(host)) return "Open in Canvas";
    return `Open on ${host}`;
  } catch {
    return "Open link";
  }
}

function DetailRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 shrink-0 text-ink-faint">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10.5px] font-medium uppercase tracking-wider text-ink-faint">{label}</p>
        <div className="mt-0.5 text-[12.5px] text-ink-soft">{children}</div>
      </div>
    </div>
  );
}

function ItemDetails({
  item,
  category,
  clock24h,
}: {
  item: Item;
  category: Category | undefined;
  clock24h: boolean;
}) {
  const setItemStatus = useDatebookStore((s) => s.setItemStatus);
  const start = new Date(item.at);
  const end = item.endAt ? new Date(item.endAt) : null;
  const isEvent = item.type === "event";
  const timeLabel = item.allDay
    ? "All day"
    : isEvent
      ? `${formatTime(item.at, clock24h)}${end ? ` – ${formatTime(item.endAt!, clock24h)}` : ""}`
      : `Due ${formatTime(item.at, clock24h)}`;

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
      <DetailRow icon={<Tag className="h-3.5 w-3.5" strokeWidth={1.75} />} label="Class">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: category?.color ?? "#8a8a94" }}
          />
          {category?.name ?? "Uncategorized"}
        </span>
      </DetailRow>

      <DetailRow
        icon={<CalendarClock className="h-3.5 w-3.5" strokeWidth={1.75} />}
        label={isEvent ? "When" : "Due"}
      >
        {format(start, "EEEE, MMMM d, yyyy")}
        <span className="text-ink-faint"> · </span>
        {timeLabel}
      </DetailRow>

      {item.location && (
        <DetailRow icon={<MapPin className="h-3.5 w-3.5" strokeWidth={1.75} />} label="Location">
          {item.location}
        </DetailRow>
      )}

      {!isEvent && item.status && (
        <DetailRow icon={<Check className="h-3.5 w-3.5" strokeWidth={1.75} />} label="Status">
          <StatusSegmented
            value={item.status}
            layoutScope={item.id}
            onChange={(status) => setItemStatus(item.id, status)}
          />
          {isOverdue(item) && item.status !== "done" && (
            <p className="mt-1.5 text-warn">Overdue</p>
          )}
        </DetailRow>
      )}

      {item.reminders && item.reminders.length > 0 && (
        <DetailRow icon={<Bell className="h-3.5 w-3.5" strokeWidth={1.75} />} label="Reminders">
          {item.reminders.map((r) => r.label).join(", ")}
        </DetailRow>
      )}

      {item.description && (
        <DetailRow
          icon={<AlignLeft className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Details"
        >
          <p className="max-h-56 overflow-y-auto whitespace-pre-line leading-relaxed text-ink-soft">
            {item.description}
          </p>
        </DetailRow>
      )}

      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-md border border-line px-3 py-2 text-[12.5px] font-medium text-accent transition-colors hover:border-accent"
        >
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
          {linkLabel(item.url)}
        </a>
      )}

      <ItemActions item={item} />
    </div>
  );
}

function ItemActions({ item }: { item: Item }) {
  const deleteItem = useDatebookStore((s) => s.deleteItem);
  const [confirm, setConfirm] = useState(false);

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {confirm ? (
        <>
          <span className="text-[12.5px] text-warn">Delete this?</span>
          <button
            type="button"
            onClick={() => {
              haptic("warn");
              deleteItem(item.id);
            }}
            className="min-h-11 rounded-lg bg-warn px-3 text-[12.5px] font-medium text-white"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirm(false)}
            className="min-h-11 rounded-lg px-3 text-[12.5px] font-medium text-ink-soft"
          >
            Keep
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          className="ml-auto flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium text-warn"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
          Delete
        </button>
      )}
    </div>
  );
}

function useExpandable(itemId: string) {
  const focusedItemId = useUIStore((s) => s.focusedItemId);
  const setFocusedItemId = useUIStore((s) => s.setFocusedItemId);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (focusedItemId === itemId) {
      setExpanded(true);
      setFocusedItemId(null);
    }
  }, [focusedItemId, itemId, setFocusedItemId]);

  const toggle = () => setExpanded((v) => !v);
  const keyToggle = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  };
  return { expanded, toggle, keyToggle };
}

function ExpandPanel({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="panel"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function useCompleteStyle(done: boolean) {
  const [styled, setStyled] = useState(done);

  useEffect(() => {
    if (!done) {
      setStyled(false);
      return;
    }
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setStyled(true);
      return;
    }
    const delayMs = Math.round(motionTokens.standard * 1000);
    const t = window.setTimeout(() => setStyled(true), delayMs);
    return () => window.clearTimeout(t);
  }, [done]);

  return styled;
}

/* ------------------------------------------------------------------ */
/* Event                                                               */
/* ------------------------------------------------------------------ */

export function EventCard({ item, category }: { item: Item; category: Category | undefined }) {
  const clock24h = useClock24h();
  const showLocation = useDatebookStore((s) => s.settings.showLocation);
  const color = category?.color ?? "#8a8a94";
  const { expanded, toggle, keyToggle } = useExpandable(item.id);

  return (
    <motion.div
      layout
      transition={{ duration: motionTokens.micro, ease: motionTokens.ease }}
      style={{ "--cat": color } as React.CSSProperties}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={toggle}
      onKeyDown={keyToggle}
      className="cat-surface cursor-pointer rounded-lg px-[var(--card-pad-x)] py-[var(--card-pad-y)] shadow-[var(--shadow-sm)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="flex items-center gap-3">
        <div className="flex w-[74px] shrink-0 flex-col leading-tight">
          <span className="text-[13px] font-semibold tabular-nums cat-text">
            {item.allDay ? "All day" : formatTime(item.at, clock24h)}
          </span>
          {!item.allDay && item.endAt && (
            <span className="text-[11px] tabular-nums text-ink-faint">
              {formatTime(item.endAt, clock24h)}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 break-words text-[14px] font-medium text-ink">{item.title}</p>
          {showLocation && item.location && (
            <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-ink-soft">
              <MapPin className="h-3 w-3 shrink-0" strokeWidth={1.75} />
              {item.location}
            </p>
          )}
          {!expanded && item.description && (
            <p className="mt-1 whitespace-pre-line text-[11.5px] leading-snug text-ink-faint line-clamp-2">
              {item.description}
            </p>
          )}
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-ink-faint transition-transform",
            expanded && "rotate-180"
          )}
          strokeWidth={1.9}
        />
      </div>

      <ExpandPanel open={expanded}>
        <ItemDetails item={item} category={category} clock24h={clock24h} />
      </ExpandPanel>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Assignment / task                                                   */
/* ------------------------------------------------------------------ */

export function AssignmentCard({ item, category }: { item: Item; category: Category | undefined }) {
  const clock24h = useClock24h();
  const cycleItemStatus = useDatebookStore((s) => s.cycleItemStatus);
  const showCategoryDot = useDatebookStore((s) => s.settings.showCategoryDot);
  const color = category?.color ?? "#8a8a94";
  const status = item.status ?? "todo";
  const done = status === "done";
  const overdue = isOverdue(item);
  const showCompleteStyle = useCompleteStyle(done);
  const { expanded, toggle, keyToggle } = useExpandable(item.id);

  return (
    <motion.div
      layout
      transition={{ duration: motionTokens.micro, ease: motionTokens.ease }}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={toggle}
      onKeyDown={keyToggle}
      className={cn(
        "cursor-pointer rounded-lg border border-line bg-surface px-[var(--card-pad-x)] py-[var(--card-pad-y)] shadow-[var(--shadow-sm)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        showCompleteStyle && "opacity-60"
      )}
    >
      <div className="flex items-center gap-1">
        <StatusCycleButton
          status={status}
          color={color}
          onCycle={() => cycleItemStatus(item.id)}
        />

        <div className="min-w-0 flex-1">
          <motion.p
            animate={{
              opacity: showCompleteStyle ? 0.85 : 1,
            }}
            transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
            className={cn(
              "line-clamp-2 break-words text-[14px] font-medium text-ink",
              showCompleteStyle && "line-through"
            )}
          >
            {item.title}
          </motion.p>
          <p
            className={cn(
              "mt-0.5 truncate text-[12px]",
              overdue && status !== "done" ? "font-medium text-warn" : "text-ink-soft"
            )}
          >
            {item.allDay ? "All day" : formatTime(item.at, clock24h)}
            {overdue && status !== "done" && " · overdue"}
            {status === "doing" && !overdue && " · in progress"}
            {status === "done" && " · done"}
          </p>
          {!expanded && item.description && (
            <p className="mt-1 whitespace-pre-line text-[11.5px] leading-snug text-ink-faint line-clamp-2">
              {item.description}
            </p>
          )}
        </div>

        {showCategoryDot && !expanded && (
          <span
            style={{ "--cat": color } as React.CSSProperties}
            className="cat-dot h-1.5 w-1.5 shrink-0 rounded-full"
          />
        )}
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-ink-faint transition-transform",
            expanded && "rotate-180"
          )}
          strokeWidth={1.9}
        />
      </div>

      <ExpandPanel open={expanded}>
        <ItemDetails item={item} category={category} clock24h={clock24h} />
      </ExpandPanel>
    </motion.div>
  );
}
