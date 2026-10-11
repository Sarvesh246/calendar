"use client";

import { motion, type MotionValue } from "framer-motion";
import { motion as motionTokens, prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** How far back a full-strength scrim pushes the page. */
const BLUR_PX = 18;

/** Veil strength at full amount, per tone. */
const DIM = { default: 0.34, light: 0.26 } as const;

/**
 * The veil behind every sheet and dialog.
 *
 * It isn't tinted from `--ink`, which is the text colour and therefore
 * near-white in every dark theme. That is what used to throw a white sheet over
 * the app whenever a menu opened.
 *
 * The blur and neutral tint are fixed at their requested strength while only
 * opacity animates. This matches the Assistant (the smooth reference surface)
 * and lets the compositor reuse one blurred layer instead of rasterizing a new
 * blur radius on every frame.
 *
 * A free-running scrim fades up from nothing on a short decelerating curve:
 * starting it part-way visible (it used to begin at 78%) read as a pop rather
 * than a fade. Opacity is the only thing animating, so the fade stays on the
 * compositor however busy the page is. `snap` is quicker still, for veils
 * behind small popovers.
 */
export function Scrim({
  onClick,
  onPointerDown,
  label,
  amount = 1,
  tone = "default",
  pace = "emphasis",
  exitDuration = motionTokens.exit,
  progress,
  className,
}: {
  onClick?: () => void;
  /** Dismiss on press rather than waiting for the release. */
  onPointerDown?: () => void;
  /** Render as a button with this accessible name, rather than a plain layer. */
  label?: string;
  /** 0–1. Below 1 the page stays partly legible (the day sheet's compact detent). */
  amount?: number;
  tone?: "default" | "light";
  pace?: "emphasis" | "snap";
  /** Match the panel's departure so the veil never lingers or clears early. */
  exitDuration?: number;
  /**
   * 0–1, driven by the sheet's position. When given, the veil is exactly as
   * strong as the sheet is open — pull a sheet halfway down and the page
   * comes halfway back — instead of running its own fade.
   */
  progress?: MotionValue<number>;
  className?: string;
}) {
  const reduced = prefersReducedMotion();
  const treatment = {
    backgroundColor: `rgba(0,0,0,${(DIM[tone] * amount).toFixed(3)})`,
    backdropFilter: `blur(${Math.round(BLUR_PX * amount)}px)`,
  };
  const snap = pace === "snap" && !reduced;

  const driven = progress
    ? { style: { ...treatment, opacity: progress } }
    : { initial: { opacity: 0 }, animate: { opacity: 1 }, style: treatment };
  const props = {
    ...driven,
    exit: {
      opacity: 0,
      transition: { duration: reduced ? motionTokens.micro : exitDuration, ease: motionTokens.easeInOut },
    },
    transition: reduced
      ? { duration: motionTokens.micro }
      : snap
        ? { duration: motionTokens.micro, ease: motionTokens.ease }
        : { duration: 0.2, ease: motionTokens.ease },
    className: cn(
      tone === "light" ? "overlay-scrim-light" : "overlay-scrim",
      // A labelled scrim is a full-viewport button. The global pressed-button
      // scale would expose a strip of the live page around all four edges.
      label && "press-none",
      "absolute inset-0",
      className
    ),
    onClick,
    onPointerDown,
  };

  if (label) {
    return <motion.button type="button" aria-label={label} {...props} />;
  }
  return <motion.div aria-hidden {...props} />;
}
