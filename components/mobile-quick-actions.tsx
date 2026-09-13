"use client";

import { motion } from "framer-motion";
import { CalendarClock, Play, Undo2 } from "lucide-react";
import { changeMobileStatus } from "@/lib/mobile-item-actions";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Item } from "@/lib/types";

/**
 * Start and Reschedule, as buttons, on the card itself.
 *
 * The swipe shortcuts are lovely once you know they exist, and completely
 * invisible until then — which meant the only *discoverable* way to start a
 * task or move it was to open the whole editor. A chevron labelled "Task status
 * and actions" was the previous answer, and a chevron is not an answer: it
 * tells you something happens without telling you what.
 *
 * So: the two actions the swipes perform, named, next to the complete circle
 * that was already there. Together they are the three the phone needs — start,
 * complete, reschedule — and nothing here opens an editor.
 *
 * Deliberately 40px wide and 44px tall with a 16px glyph: the touch target is
 * generous, the icon is not. Making the icon big enough to match the target is
 * how a card full of controls stops looking like a card with a title on it.
 */
export function MobileQuickActions({
  item,
  onReschedule,
}: {
  item: Item;
  /** Opens the reschedule sheet, which owns the deadline/work-session choice. */
  onReschedule: () => void;
}) {
  const status = item.status ?? "todo";
  const doing = status === "doing";
  const done = status === "done";

  // A finished task needs one control, and it is not "start". Reopening is the
  // only thing you are plausibly here to do.
  if (done) {
    return (
      <ActionButton
        label="Reopen"
        onPress={() => changeMobileStatus(item, "todo")}
      >
        <Undo2 className="h-4 w-4" strokeWidth={2} aria-hidden />
      </ActionButton>
    );
  }

  return (
    <>
      <ActionButton
        label={doing ? "Stop working on this" : "Start working on this"}
        active={doing}
        onPress={() => changeMobileStatus(item, doing ? "todo" : "doing")}
      >
        <Play
          className="h-4 w-4"
          strokeWidth={2}
          fill={doing ? "currentColor" : "none"}
          aria-hidden
        />
      </ActionButton>
      <ActionButton label="Reschedule" onPress={onReschedule}>
        <CalendarClock className="h-4 w-4" strokeWidth={2} aria-hidden />
      </ActionButton>
    </>
  );
}

function ActionButton({
  label,
  active = false,
  onPress,
  children,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      // The press responds on contact rather than on release, so a tap never
      // feels like it is waiting to find out whether it was a swipe.
      whileTap={{ scale: 0.88 }}
      transition={motionTokens.springSnappy}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        haptic("light");
        onPress();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      className={cn(
        "press-none flex h-11 w-10 shrink-0 items-center justify-center rounded-lg",
        "transition-colors duration-[var(--motion-standard)]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        active ? "bg-accent-soft text-accent" : "text-ink-soft active:bg-surface-sunken"
      )}
    >
      {children}
    </motion.button>
  );
}
