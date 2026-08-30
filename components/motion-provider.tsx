"use client";

import { MotionConfig } from "framer-motion";
import { tween } from "@/lib/motion";

/**
 * `reducedMotion="user"` makes every Framer Motion animation honour the OS
 * "reduce motion" setting — transform/layout animations are dropped, opacity
 * fades are kept. The CSS `@media (prefers-reduced-motion)` block in globals.css
 * only covers CSS animations/transitions, not Framer's inline/WAAPI ones.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig
      reducedMotion="user"
      transition={tween.standard}
    >
      {children}
    </MotionConfig>
  );
}
