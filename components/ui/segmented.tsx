"use client";

import { startTransition } from "react";
import type { LucideIcon } from "lucide-react";
import { haptic } from "@/lib/haptic";
import { useSlidingPill } from "@/lib/sliding-pill";
import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  Icon?: LucideIcon;
  /** Tooltip, e.g. the keyboard shortcut. */
  title?: string;
}

/**
 * The one segmented control. Every toolbar toggle in the app (Agenda layout
 * and view, Calendar month/week, Settings pickers) shares its geometry so
 * adjacent controls line up: 36px tall on a desk, 44px where it's a touch
 * target. The highlight is `useSlidingPill`, moved from the click itself.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "desk",
  fill = false,
  className,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  /** Accessible name for the group. */
  label: string;
  size?: "desk" | "touch";
  /** Stretch to the container's width with equal segments. */
  fill?: boolean;
  className?: string;
}) {
  const { containerRef, pillRef, moveTo } = useSlidingPill(value);
  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={label}
      className={cn(
        "relative items-center gap-0.5 rounded-[10px] border border-line bg-surface p-0.5",
        fill ? "grid auto-cols-fr grid-flow-col" : "inline-flex",
        className,
      )}
    >
      <span ref={pillRef} aria-hidden className="sliding-pill rounded-[7px] bg-accent" />
      {options.map(({ value: v, label: text, Icon, title }) => {
        const active = v === value;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            title={title}
            data-pill-key={v}
            onClick={(e) => {
              if (active) return;
              haptic("selection");
              moveTo(e.currentTarget);
              startTransition(() => onChange(v));
            }}
            className={cn(
              "press-none relative flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] font-medium",
              "transition-colors duration-[var(--motion-micro)]",
              "text-ink-soft hover:text-ink data-[pill-on]:text-accent-ink",
              size === "desk" ? "h-[30px] px-3 text-[13px]" : "h-[38px] px-4 text-[14px]",
            )}
          >
            {Icon && <Icon aria-hidden className="relative z-[1] h-3.5 w-3.5" strokeWidth={1.9} />}
            <span className="relative z-[1]">{text}</span>
          </button>
        );
      })}
    </div>
  );
}
