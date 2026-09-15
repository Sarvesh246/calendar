"use client";

import { useCalendarDrag } from "@/lib/calendar-drag";

/** The destination of a calendar drag, riding just off the pointer. */
export function DragOverlay() {
  const label = useCalendarDrag((s) => s.label);
  const x = useCalendarDrag((s) => s.x);
  const y = useCalendarDrag((s) => s.y);
  if (!label) return null;
  // Flip to the pointer's left near the right edge so the label never clips.
  const flip = typeof window !== "undefined" && x > window.innerWidth - 260;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed left-0 top-0 z-[47] whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-[12px] font-medium tabular-nums text-surface shadow-[0_8px_24px_-8px_rgb(0_0_0/0.35)]"
      style={{
        transform: flip
          ? `translate3d(calc(${x - 14}px - 100%), ${y + 16}px, 0)`
          : `translate3d(${x + 14}px, ${y + 16}px, 0)`,
      }}
    >
      {label}
    </div>
  );
}
