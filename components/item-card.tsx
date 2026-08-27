"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { AlignLeft, Bell, CalendarClock, Check, ChevronDown, ExternalLink, MapPin, Tag } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { formatTime, isOverdue } from "@/lib/date-utils";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Category, Item } from "@/lib/types";

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
/* Shared expand/collapse detail panel                                 */
/* ------------------------------------------------------------------ */

const STATUS_LABEL: Record<string, string> = {
  todo: "To do",
  doing: "In progress",
  done: "Done",
};

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
      <div className="min-w-0">
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
          {STATUS_LABEL[item.status] ?? item.status}
          {isOverdue(item) && <span className="text-warn"> · overdue</span>}
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
          className="inline-flex w-fit items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12px] font-medium text-accent transition-colors hover:border-accent"
        >
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
          {linkLabel(item.url)}
        </a>
      )}
    </div>
  );
}

function useExpandable() {
  const [expanded, setExpanded] = useState(false);
  const toggle = () => setExpanded((v) => !v);
  const keyToggle = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  };
  return { expanded, toggle, keyToggle };
}

/* ------------------------------------------------------------------ */
/* Event                                                               */
/* ------------------------------------------------------------------ */

export function EventCard({ item, category }: { item: Item; category: Category | undefined }) {
  const clock24h = useClock24h();
  const showLocation = useDatebookStore((s) => s.settings.showLocation);
  const color = category?.color ?? "#8a8a94";
  const { expanded, toggle, keyToggle } = useExpandable();

  return (
    <motion.div
      layout
      whileHover={{ y: -2 }}
      transition={{ duration: motionTokens.micro, ease: motionTokens.ease }}
      style={{ "--cat": color } as React.CSSProperties}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={toggle}
      onKeyDown={keyToggle}
      className="cat-surface cursor-pointer rounded-lg px-4 py-3 shadow-[var(--shadow-sm)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
          <p className="truncate text-[14px] font-medium text-ink">{item.title}</p>
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

      {expanded && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
        >
          <ItemDetails item={item} category={category} clock24h={clock24h} />
        </motion.div>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Assignment / task                                                   */
/* ------------------------------------------------------------------ */

export function AssignmentCard({ item, category }: { item: Item; category: Category | undefined }) {
  const clock24h = useClock24h();
  const cycleItemStatus = useDatebookStore((s) => s.cycleItemStatus);
  const color = category?.color ?? "#8a8a94";
  const done = item.status === "done";
  const overdue = isOverdue(item);
  const { expanded, toggle, keyToggle } = useExpandable();

  return (
    <motion.div
      layout
      whileHover={{ y: -1 }}
      transition={{ duration: motionTokens.micro, ease: motionTokens.ease }}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={toggle}
      onKeyDown={keyToggle}
      className={cn(
        "cursor-pointer rounded-lg border border-line bg-surface px-4 py-3 shadow-[var(--shadow-sm)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        done && "opacity-60"
      )}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            cycleItemStatus(item.id);
          }}
          aria-label={done ? "Mark incomplete" : "Mark complete"}
          style={{ "--cat": color } as React.CSSProperties}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
            done ? "border-good bg-good" : "cat-ring border-[color-mix(in_srgb,var(--cat)_55%,transparent)]"
          )}
        >
          <motion.span
            initial={false}
            animate={{ scale: done ? 1 : 0, opacity: done ? 1 : 0 }}
            transition={{ duration: motionTokens.micro, ease: motionTokens.ease }}
          >
            <Check className="h-3 w-3 text-white" strokeWidth={3} />
          </motion.span>
        </button>

        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-[14px] font-medium text-ink", done && "line-through")}>
            {item.title}
          </p>
          <p
            className={cn(
              "mt-0.5 truncate text-[12px]",
              overdue ? "font-medium text-warn" : "text-ink-soft"
            )}
          >
            {item.allDay ? "All day" : formatTime(item.at, clock24h)}
            {overdue && " · overdue"}
            {item.status === "doing" && !overdue && " · in progress"}
          </p>
          {!expanded && item.description && (
            <p className="mt-1 whitespace-pre-line text-[11.5px] leading-snug text-ink-faint line-clamp-2">
              {item.description}
            </p>
          )}
        </div>

        {!expanded && (
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

      {expanded && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
        >
          <ItemDetails item={item} category={category} clock24h={clock24h} />
        </motion.div>
      )}
    </motion.div>
  );
}
