/**
 * Shared motion vocabulary. Every animation in the app pulls its timing from
 * here so the whole product moves with one hand — durations for things that
 * fade or travel a fixed distance, springs for anything a finger "throws".
 *
 * Rule of thumb:
 *  - `micro`      hover/press colour + opacity shifts
 *  - `standard`   panel fades, toasts, small reveals
 *  - `emphasis`   sheets, dialogs, anything covering the screen
 *  - `spring`     size/position changes the eye follows (expanding cards,
 *                 sliding pills) — a settle reads as "physical", a tween reads
 *                 as "computed"
 */
export const motion = {
  micro: 0.12,
  standard: 0.22,
  emphasis: 0.34,
  /** Exits should be quicker than entrances — you already know what's leaving. */
  exit: 0.16,

  /** Decelerating; for things arriving. */
  ease: [0.2, 0.8, 0.2, 1] as const,
  /** Accelerating; for things leaving. */
  easeIn: [0.4, 0, 1, 1] as const,
  /** Symmetric; for cross-fades and colour. */
  easeInOut: [0.4, 0, 0.2, 1] as const,

  /** Default settle — carries weight without wobbling. */
  spring: { type: "spring" as const, stiffness: 520, damping: 34, mass: 0.55 },
  /** For small controls that should feel instant but not brittle. */
  springSnappy: { type: "spring" as const, stiffness: 640, damping: 38, mass: 0.45 },
  /** For large surfaces (sheets, expanding panels) — slower, fully damped so a
   *  tall panel never overshoots past the fold. */
  springGentle: { type: "spring" as const, stiffness: 320, damping: 34, mass: 0.9 },
  /** Layout/size changes: critically damped, so height never bounces. */
  springLayout: { type: "spring" as const, stiffness: 400, damping: 40, mass: 0.8 },
};

/** Tween shorthands, so callers don't repeat `{ duration, ease }` everywhere. */
export const tween = {
  micro: { duration: motion.micro, ease: motion.ease },
  standard: { duration: motion.standard, ease: motion.ease },
  emphasis: { duration: motion.emphasis, ease: motion.ease },
  exit: { duration: motion.exit, ease: motion.easeIn },
};

/** True when the OS asks for reduced motion. Safe to call during render. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
