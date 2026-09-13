"use client";

import { motion, type DragControls } from "framer-motion";
import { motion as motionTokens } from "@/lib/motion";
import { startSheetDrag } from "@/lib/sheet-gesture";
import { cn } from "@/lib/utils";

/**
 * The affordance that says a sheet can be pulled away — a wider, taller
 * hit target than the 4px bar it draws, so you don't have to aim.
 */
export function SheetHandle({
  dragControls,
  dragging,
  className,
}: {
  dragControls: DragControls;
  dragging?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 cursor-grab touch-none flex-col items-center py-2.5 active:cursor-grabbing",
        className
      )}
      onPointerDown={(e) => startSheetDrag(dragControls, e)}
    >
      <motion.span
        aria-hidden
        animate={{ scaleX: dragging ? 1.35 : 1, opacity: dragging ? 1 : 0.72 }}
        transition={motionTokens.springSnappy}
        className="h-1 w-11 rounded-full bg-line-strong"
      />
    </div>
  );
}
