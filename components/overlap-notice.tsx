"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Layers } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useCategoriesById } from "@/lib/card-chrome";
import { formatTime } from "@/lib/date-utils";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens, prefersReducedMotion } from "@/lib/motion";
import { overlapLabel, type OverlapGroup } from "@/lib/overlap";
import { cn } from "@/lib/utils";

/**
 * "Two of these are at the same time" — in words, on a screen too narrow to
 * show it any other way.
 *
 * The week grid answers this by drawing colliding events side by side, which on
 * a phone is two 80px slivers of truncated text. And the day *list* — what
 * phones actually show — never answered it at all: a 9:00 lecture and a 9:00
 * lab appear as two ordinary rows in sequence, reading as "first this, then
 * that", which is precisely the misunderstanding that makes you miss one.
 *
 * So the list gets a compact line that states the collision and, on tap,
 * expands into the readable comparison: each event, its full time range, its
 * class. No shrinking, no side-by-side, nothing to decipher.
 */
export function OverlapNotice({ group }: { group: OverlapGroup }) {
  const [open, setOpen] = useState(false);
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const categories = useCategoriesById();
  // Height is a reflow, not a transform, so framer's reduced-motion handling
  // does not cover it. Disclosure still works; it just appears.
  const reduced = prefersReducedMotion();

  return (
    <div className="overflow-hidden rounded-lg border border-warn/40 bg-warn-soft">
      <button
        type="button"
        onClick={() => {
          haptic("light");
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        className="press-none flex min-h-11 w-full items-center gap-2 px-3 text-left"
      >
        <Layers className="h-3.5 w-3.5 shrink-0 text-warn" strokeWidth={2} aria-hidden />
        <span className="min-w-0 flex-1 text-[12.5px] font-medium text-warn">
          {overlapLabel(group)}
          {group.overlapMin > 0 && (
            <span className="font-normal opacity-80"> · {durationWords(group.overlapMin)}</span>
          )}
        </span>
        <motion.span
          aria-hidden
          initial={false}
          animate={{ rotate: open ? 180 : 0 }}
          transition={motionTokens.springSnappy}
          className="shrink-0 text-warn"
        >
          <ChevronDown className="h-4 w-4" strokeWidth={2} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="detail"
            initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={reduced ? motionTokens.tweenStandard : motionTokens.springLayout}
            className="overflow-hidden"
          >
            <ul className="flex flex-col gap-px border-t border-warn/25 px-3 py-2">
              {group.items.map((item) => {
                const category = item.categoryId ? categories.get(item.categoryId) : undefined;
                return (
                  <li key={item.id} className="flex items-baseline gap-2 py-1">
                    <span
                      aria-hidden
                      className="mt-1 h-2 w-2 shrink-0 self-start rounded-full"
                      style={{ background: category?.color ?? "var(--ink-faint)" }}
                    />
                    <span className="min-w-0 flex-1">
                      {/* Wraps rather than truncates: the whole point of opening
                          this is to read both titles in full. */}
                      <span className="block text-[13px] font-medium text-ink">{item.title}</span>
                      <span className="block text-[11.5px] tabular-nums text-ink-soft">
                        {rangeLabel(item.at, item.endAt, clock24h)}
                        {category && ` · ${category.name}`}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Notices for every collision in a day, or nothing at all. Rendering this above
 * a day's list is the whole integration.
 */
export function OverlapNotices({
  groups,
  className,
}: {
  groups: OverlapGroup[];
  className?: string;
}) {
  if (groups.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {groups.map((group) => (
        <OverlapNotice key={group.key} group={group} />
      ))}
    </div>
  );
}

function rangeLabel(at: string, endAt: string | undefined, clock24h: boolean): string {
  const start = formatTime(at, clock24h);
  if (!endAt) return start;
  const end = new Date(endAt);
  if (Number.isNaN(end.getTime())) return start;
  return `${start} – ${formatTime(endAt, clock24h)}`;
}

function durationWords(minutes: number): string {
  if (minutes < 60) return `${minutes} min together`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `${hours}h together`;
  return `${hours}h ${rest}m together`;
}
