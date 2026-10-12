/**
 * The small physics every hand-rolled gesture in the app shares.
 *
 * Framer's own drag already does most of this; these are for the gestures it
 * doesn't own (the tab pager, the tab bar scrub, trackpad wheels) and for the
 * release decisions on top of Framer drags, so every gesture reads velocity,
 * resists at its edges and decides where it's going the same way.
 */

/** How far back the velocity estimate looks. Longer smooths 120Hz jitter. */
const VELOCITY_WINDOW_MS = 100;
/** A finger that has held still this long has no velocity, whatever came before. */
const VELOCITY_STALE_MS = 60;

/**
 * Velocity from the last ~100ms of samples rather than the last two — one
 * jittery sample on a 120Hz screen used to flip a commit decision — and zero
 * once the finger has held still, so "drag, pause, lift" is never a flick.
 */
export class VelocityTracker {
  private samples: { v: number; t: number }[] = [];

  reset(value: number, time: number) {
    this.samples = [{ v: value, t: time }];
  }

  add(value: number, time: number) {
    this.samples.push({ v: value, t: time });
    const cutoff = time - VELOCITY_WINDOW_MS;
    while (this.samples.length > 2 && this.samples[0].t < cutoff) this.samples.shift();
  }

  /** Units per second at `now` (pass the release event's timestamp). */
  velocity(now: number): number {
    const s = this.samples;
    if (s.length < 2) return 0;
    const last = s[s.length - 1];
    if (now - last.t > VELOCITY_STALE_MS) return 0;
    const first = s[0];
    const dt = last.t - first.t;
    if (dt <= 0) return 0;
    return ((last.v - first.v) / dt) * 1000;
  }
}

/**
 * Apple's rubber-band: tracks almost 1:1 at first and stiffens the further you
 * pull, approaching (but never reaching) `dimension`. A linear factor never
 * stiffens, so a long overdrag kept going like taffy.
 */
export function rubberband(distance: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0 || distance === 0) return 0;
  const sign = Math.sign(distance);
  const d = Math.abs(distance);
  return sign * ((d * dimension * constant) / (dimension + constant * d));
}

/**
 * Track 1:1 inside [min, max] and rubber-band past either end. `dimension`
 * scales how much room the overdrag gets before it stiffens.
 */
export function rubberbandClamp(
  value: number,
  min: number,
  max: number,
  dimension: number,
): number {
  if (value < min) return min + rubberband(value - min, dimension);
  if (value > max) return max + rubberband(value - max, dimension);
  return value;
}

/**
 * Where a released object would come to rest if it coasted — UIScrollView's
 * deceleration projection. Commit decisions use this instead of separate
 * "past halfway" and "fast enough" rules, so a short quick flick and a long
 * slow drag are judged on the same scale. UIKit's scroll views coast at 0.998;
 * 0.995 (≈ 0.2s of travel at release speed) suits paged surfaces and sheets,
 * where the object is about to be caught by a spring anyway.
 */
export function project(position: number, velocity: number, decelerationRate = 0.995): number {
  return position + (velocity / 1000) * (decelerationRate / (1 - decelerationRate));
}

/** Pick the snap point nearest to where a release would coast to. */
export function nearestSnap(projected: number, points: number[]): number {
  let best = points[0];
  for (const p of points) if (Math.abs(p - projected) < Math.abs(best - projected)) best = p;
  return best;
}
