"use client";

import { motion } from "framer-motion";
import { Check, MapPin } from "lucide-react";
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

export function EventCard({ item, category }: { item: Item; category: Category | undefined }) {
  const clock24h = useClock24h();
  const showLocation = useDatebookStore((s) => s.settings.showLocation);
  const color = category?.color ?? "#8a8a94";

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ duration: motionTokens.micro, ease: motionTokens.ease }}
      style={{ "--cat": color } as React.CSSProperties}
      className="cat-surface flex items-center gap-3 rounded-lg px-4 py-3 shadow-[var(--shadow-sm)]"
    >
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
        {item.description && (
          <p className="mt-1 whitespace-pre-line text-[11.5px] leading-snug text-ink-faint line-clamp-2">
            {item.description}
          </p>
        )}
      </div>
    </motion.div>
  );
}

export function AssignmentCard({ item, category }: { item: Item; category: Category | undefined }) {
  const clock24h = useClock24h();
  const cycleItemStatus = useDatebookStore((s) => s.cycleItemStatus);
  const color = category?.color ?? "#8a8a94";
  const done = item.status === "done";
  const overdue = isOverdue(item);

  return (
    <motion.div
      layout
      whileHover={{ y: -1 }}
      transition={{ duration: motionTokens.micro, ease: motionTokens.ease }}
      className={cn(
        "flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-[var(--shadow-sm)]",
        done && "opacity-60"
      )}
    >
      <button
        onClick={() => cycleItemStatus(item.id)}
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
        {item.description && (
          <p className="mt-1 whitespace-pre-line text-[11.5px] leading-snug text-ink-faint line-clamp-2">
            {item.description}
          </p>
        )}
      </div>

      <span
        style={{ "--cat": color } as React.CSSProperties}
        className="cat-dot h-1.5 w-1.5 shrink-0 rounded-full"
      />
    </motion.div>
  );
}
