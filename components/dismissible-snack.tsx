"use client";

import { useRef, type ComponentProps, type ReactNode } from "react";
import { animate, motion, useMotionValue, type PanInfo } from "framer-motion";
import { project } from "@/lib/gesture";
import { releaseSpring } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Released heading far enough down (projected), or flicked down. */
export function snackDragDismisses(_: unknown, info: PanInfo) {
  return project(info.offset.y, info.velocity.y) > 44 || info.velocity.y > 420;
}

const SNACK_DRAG = {
  drag: "y" as const,
  dragDirectionLock: true,
  dragConstraints: { top: 0, bottom: 0 },
  // Follows the finger 1:1 downward (the way it leaves), resists upward.
  dragElastic: { top: 0.08, bottom: 1 },
  dragMomentum: false,
};

/**
 * Flick down or tap × — same manners as the save pill. Never runs undo.
 *
 * A flicked snack keeps going down at the speed it left the finger while it
 * fades, rather than snapping back to its resting spot to play a canned exit.
 * `layout="position"` lets the snacks stacked with it glide into the space it
 * leaves instead of jumping.
 */
export function DismissibleSnack({
  children,
  onDismiss,
  className,
  style,
  ...rest
}: {
  children: ReactNode;
  onDismiss: () => void;
  className?: string;
} & Omit<ComponentProps<typeof motion.div>, "children" | "onDragEnd">) {
  const y = useMotionValue(0);
  const opacity = useMotionValue(1);
  const leaving = useRef(false);
  return (
    <motion.div
      layout="position"
      {...rest}
      {...SNACK_DRAG}
      style={{ ...style, y, opacity }}
      onDragEnd={(e, info) => {
        if (leaving.current) return;
        if (snackDragDismisses(e, info)) {
          leaving.current = true;
          const v = Math.max(0, info.velocity.y);
          void animate(opacity, 0, { duration: 0.16 });
          void animate(y, y.get() + 90, { ...releaseSpring(v, 1, 0.3), restDelta: 2 }).then(
            onDismiss,
          );
          return;
        }
        void animate(y, 0, releaseSpring(info.velocity.y, 0.8, 0.32));
      }}
      className={cn("touch-none", className)}
    >
      {children}
    </motion.div>
  );
}

export function SnackDismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Dismiss"
      className="press-none flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-faint active:bg-surface-sunken"
    >
      <span aria-hidden className="text-[15px] leading-none">
        ×
      </span>
    </button>
  );
}
