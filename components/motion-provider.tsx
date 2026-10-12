"use client";

import { MotionConfig } from "framer-motion";
import { useEffect } from "react";
import { tween } from "@/lib/motion";

const noop = () => {};

/**
 * `reducedMotion="user"` makes every Framer Motion animation honour the OS
 * "reduce motion" setting — transform/layout animations are dropped, opacity
 * fades are kept. The CSS `@media (prefers-reduced-motion)` block in globals.css
 * only covers CSS animations/transitions, not Framer's inline/WAAPI ones.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  // iOS Safari only applies `:active` to elements while a touch listener
  // exists somewhere in the document — without one, a quick tap shows no
  // press at all and every button feels dead under the finger.
  useEffect(() => {
    document.addEventListener("touchstart", noop, { passive: true });
    return () => document.removeEventListener("touchstart", noop);
  }, []);

  return (
    <MotionConfig reducedMotion="user" transition={tween.standard}>
      {children}
    </MotionConfig>
  );
}
