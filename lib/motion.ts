/**
 * Shared motion vocabulary. Every animation in the app pulls its timing from
 * here so the whole product moves with one hand.
 *
 * Springs are written the way Apple writes them — `response` (how long one
 * swing takes, in seconds) and `dampingFraction` (1 = settles with no
 * overshoot, lower = a little life on landing) — instead of raw stiffness and
 * damping, because those two numbers describe what you actually see. SwiftUI's
 * own defaults are response 0.55 / damping 0.825; an interactive drag uses
 * ~0.15 / 0.86.
 *
 * Rule of thumb:
 *  - `settle`  anything that changes height or pushes siblings (no overshoot —
 *              a list that bounces reads as broken)
 *  - `glide`   sheets, pages, large surfaces: lands softly with a hint of weight
 *  - `nudge`   controls, pills, menus, toasts: quick with a whisper of life
 *  - `pop`     check marks, badges, counters — the small rewards; overshoots
 *  - `release(v)` anything a finger lets go of. Always carries the finger's
 *              velocity so a gesture never "catches" at the hand-off.
 */

export interface SpringTransition {
  type: "spring";
  stiffness: number;
  damping: number;
  mass: number;
  velocity?: number;
  restDelta?: number;
  restSpeed?: number;
}

/**
 * SwiftUI-style spring → Framer stiffness/damping (mass 1).
 * stiffness = (2π / response)², damping = 4π · dampingFraction / response.
 */
export function appleSpring(response: number, dampingFraction: number): SpringTransition {
  const stiffness = Math.pow((2 * Math.PI) / response, 2);
  const damping = (4 * Math.PI * dampingFraction) / response;
  return {
    type: "spring",
    stiffness: Math.round(stiffness * 10) / 10,
    damping: Math.round(damping * 100) / 100,
    mass: 1,
  };
}

const settle = appleSpring(0.36, 1);
const glide = appleSpring(0.42, 0.86);
const nudge = appleSpring(0.32, 0.76);
const pop = appleSpring(0.34, 0.52);

export const motion = {
  micro: 0.12,
  standard: 0.22,
  emphasis: 0.34,
  /** Exits should be quicker than entrances — you already know what's leaving. */
  exit: 0.16,

  /** Decelerating; for things arriving. */
  ease: [0.2, 0.8, 0.2, 1] as const,
  /** Accelerating; only for fades of things that aren't already moving. */
  easeIn: [0.4, 0, 1, 1] as const,
  /** Symmetric; for cross-fades and colour. */
  easeInOut: [0.4, 0, 0.2, 1] as const,

  settle,
  glide,
  nudge,
  pop,

  /** Default for position/size changes the eye follows. */
  spring: nudge,
  /** Small controls that should feel instant but alive. */
  springSnappy: appleSpring(0.28, 0.72),
  /** Large surfaces (sheets, expanding panels). */
  springGentle: glide,
  /** Height / layout changes: critically damped, never bounces a list. */
  springLayout: settle,

  /** The plain fade a disclosure falls back to under reduced motion, where an
   *  animating height would reflow the page the reader is looking at. */
  tweenStandard: { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] as const },
};

/**
 * The spring for a released gesture. Carries the finger's speed (px/s) so the
 * motion continues instead of restarting from rest. `dampingFraction` 1 for
 * things heading off-screen, a little lower for things landing on a detent.
 */
export function releaseSpring(velocity: number, dampingFraction = 0.88, response = 0.4): SpringTransition {
  return { ...appleSpring(response, dampingFraction), velocity };
}

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

/**
 * A spring rendered as a CSS / WAAPI `linear()` easing, so compositor-run
 * animations (sliding pills, CSS transitions) get the same physics as Framer.
 * Returns the easing string and how long the spring takes to come to rest.
 */
export function springEasing(
  response: number,
  dampingFraction: number,
  samples = 40
): { easing: string; duration: number } {
  const omega = (2 * Math.PI) / response;
  const zeta = dampingFraction;
  // Position of a unit step response at time t (starting at 0, heading to 1).
  const at = (t: number) => {
    if (zeta < 1) {
      const wd = omega * Math.sqrt(1 - zeta * zeta);
      return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
    }
    return 1 - Math.exp(-omega * t) * (1 + omega * t);
  };
  // Rest = within 0.1% and staying there.
  let duration = 0.05;
  for (let t = 0; t < 3; t += 0.004) {
    if (Math.abs(1 - at(t)) > 0.001) duration = t;
  }
  duration = Math.min(2, duration + 0.02);
  const points: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const v = at((duration * i) / samples);
    points.push(i === samples ? "1" : String(Math.round(v * 10000) / 10000));
  }
  return { easing: `linear(${points.join(", ")})`, duration: Math.round(duration * 1000) };
}

let linearSupport: boolean | null = null;
/** Whether this engine understands `linear()` easing (Safari 17.2+, Chrome 113+). */
export function supportsLinearEasing(): boolean {
  if (linearSupport !== null) return linearSupport;
  linearSupport =
    typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("transition-timing-function", "linear(0, 1)");
  return linearSupport;
}
