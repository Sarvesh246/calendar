"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * A number whose digits roll to their new value — up when it grows, down when
 * it shrinks — instead of swapping in place. Only the digits that changed
 * move, so 19 → 20 rolls both and 12 → 13 rolls one: the count visibly ticks,
 * which is the small confirmation that closes the loop on an action ("you
 * did one, and the number went down").
 *
 * Relies on `tabular-nums` so the width never jitters mid-roll.
 */
export function NumberRoll({ value, className }: { value: number; className?: string }) {
  // Direction from the previous value, worked out during render so the very
  // first frame of the roll already goes the right way. Each column (ones,
  // tens…) keeps a revision that ticks whenever its digit changes: keying the
  // rolling digit by its *value* collided when a count went 1 → 0 → 1 inside
  // one roll (the old "1" still leaving as the new "1" arrived).
  const [state, setState] = useState(() => ({ value, dir: 1, revs: placesOf(value).map(() => 0) }));
  if (state.value !== value) {
    const before = placesOf(state.value);
    const after = placesOf(value);
    setState({
      value,
      dir: value > state.value ? 1 : -1,
      revs: after.map((digit, place) => (before[place] === digit ? state.revs[place] ?? 0 : (state.revs[place] ?? 0) + 1)),
    });
  }
  const dir = state.dir;
  const digits = String(value).split("");

  return (
    <span className={cn("relative inline-flex tabular-nums", className)}>
      <span className="sr-only">{value}</span>
      <span aria-hidden className="inline-flex">
        {digits.map((digit, i) => {
          const place = digits.length - 1 - i;
          return (
            // Keyed by place (ones, tens…) so a digit keeps its column.
            <span key={place} className="relative inline-flex overflow-hidden">
              <AnimatePresence initial={false} mode="popLayout" custom={dir}>
                <motion.span
                  key={state.revs[place] ?? 0}
                  custom={dir}
                  variants={rollVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="inline-block"
                >
                  {digit}
                </motion.span>
              </AnimatePresence>
            </span>
          );
        })}
      </span>
    </span>
  );
}

/** Digits by place value, ones first. */
function placesOf(n: number): string[] {
  return String(n).split("").reverse();
}

const rollVariants = {
  enter: (dir: number) => ({ y: dir > 0 ? "70%" : "-70%", opacity: 0 }),
  center: { y: "0%", opacity: 1, transition: { y: motionTokens.nudge, opacity: { duration: 0.16 } } },
  exit: (dir: number) => ({
    y: dir > 0 ? "-70%" : "70%",
    opacity: 0,
    transition: { y: motionTokens.nudge, opacity: { duration: 0.12 } },
  }),
};
