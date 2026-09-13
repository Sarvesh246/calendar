"use client";

import type { ComponentProps, ReactNode } from "react";
import { motion, type PanInfo } from "framer-motion";
import { cn } from "@/lib/utils";

export function snackDragDismisses(_: unknown, info: PanInfo) {
  return info.offset.y > 28 || info.velocity.y > 420;
}

const SNACK_DRAG = {
  drag: "y" as const,
  dragDirectionLock: true,
  dragSnapToOrigin: true,
  dragConstraints: { top: 0, bottom: 0 },
  dragElastic: { top: 0.06, bottom: 0.7 },
};

/** Flick down or tap × — same manners as the save pill. Never runs undo. */
export function DismissibleSnack({
  children,
  onDismiss,
  className,
  ...rest
}: {
  children: ReactNode;
  onDismiss: () => void;
  className?: string;
} & Omit<ComponentProps<typeof motion.div>, "children" | "onDragEnd">) {
  return (
    <motion.div
      {...rest}
      {...SNACK_DRAG}
      onDragEnd={(e, info) => {
        if (snackDragDismisses(e, info)) onDismiss();
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
