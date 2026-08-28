"use client";

import { MotionConfig } from "framer-motion";
import { motion as motionTokens } from "@/lib/motion";

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
      transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
    >
      {children}
    </MotionConfig>
  );
}
