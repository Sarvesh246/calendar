"use client";

import { motion } from "framer-motion";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";

const THUMB_TRAVEL = 20;

export function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "press-none relative inline-flex h-7 w-[3.25rem] shrink-0 cursor-pointer items-center rounded-full p-0.5",
        "transition-colors duration-200",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-base)]",
        checked ? "bg-accent" : "bg-surface-sunken"
      )}
    >
      <motion.span
        aria-hidden
        className="pointer-events-none block h-6 w-6 rounded-full bg-surface-elevated shadow-[var(--shadow-sm)] ring-1 ring-line"
        animate={{ x: checked ? THUMB_TRAVEL : 0 }}
        transition={motionTokens.spring}
      />
    </button>
  );
}
