"use client";

import { AnimatePresence, motion } from "framer-motion";
import { motion as motionTokens, prefersReducedMotion } from "@/lib/motion";

/**
 * A disclosure that opens and closes instead of appearing and vanishing.
 *
 * Height is not a transform, so `MotionConfig reducedMotion="user"` does not
 * cover it — the reduced-motion path here is a plain fade, checked by hand.
 * `overflow-hidden` lives on the animating element only while it moves, so a
 * settled panel can still show focus rings and popovers that spill out of it.
 */
export function Reveal({
  open,
  children,
  className,
}: {
  open: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const reduced = prefersReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="reveal"
          initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          animate={reduced ? { opacity: 1 } : { height: "auto", opacity: 1 }}
          exit={
            reduced
              ? { opacity: 0, transition: { duration: motionTokens.exit } }
              : {
                  height: 0,
                  opacity: 0,
                  transition: { duration: motionTokens.exit, ease: motionTokens.easeIn },
                }
          }
          transition={reduced ? motionTokens.tweenStandard : motionTokens.springLayout}
          style={{ overflow: "hidden" }}
          className={className}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
