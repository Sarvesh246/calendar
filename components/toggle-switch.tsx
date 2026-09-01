"use client";

import { motion } from "framer-motion";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";

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
      onClick={() => {
        haptic("light");
        onChange(!checked);
      }}
      className={cn(
        "press-none relative inline-flex h-7 w-[3.25rem] shrink-0 cursor-pointer items-center rounded-full p-0.5",
        "transition-colors duration-[var(--motion-standard)] ease-[var(--ease-standard)]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-base)]",
        checked ? "bg-accent" : "bg-surface-sunken"
      )}
    >
      <motion.span
        aria-hidden
        className="pointer-events-none block h-6 w-6 rounded-full bg-surface-elevated ring-1 ring-line"
        // The knob stretches toward its destination as it travels — the trick
        // iOS uses to make a 24px slide feel like a physical throw.
        animate={{ x: checked ? 24 : 0 }}
        whileTap={{ scaleX: 1.15 }}
        transition={motionTokens.spring}
      />
    </button>
  );
}
