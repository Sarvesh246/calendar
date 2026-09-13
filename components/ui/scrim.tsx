"use client";

import { motion } from "framer-motion";
import { motion as motionTokens, prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** How far back a full-strength scrim pushes the page. */
const BLUR_PX = 18;

/** Veil strength at full amount, per tone. */
const DIM = { default: 0.34, light: 0.22 } as const;

/**
 * The veil behind every sheet and dialog.
 *
 * Two things it deliberately does not do.
 *
 * It doesn't fade a pre-blurred layer in and out. A backdrop filter composites
 * with its own element's opacity, so a scrim at 15% opacity is barely blurring
 * anything: the page snapped back into focus in the first few frames of a
 * dismissal and then the sheet spent another 200ms sliding away in front of a
 * perfectly sharp background. That mismatch is what read as the page flashing.
 * So opacity stays at 1 and the *blur radius* and the veil's own alpha are what
 * travel — the page defocuses and refocuses, which is the thing a scrim is
 * imitating in the first place.
 *
 * And it isn't tinted from `--ink`, which is the text colour and therefore
 * near-white in every dark theme. That is what used to throw a white sheet over
 * the app whenever a menu opened.
 *
 * Animating a backdrop filter costs a re-blur per frame, so it is deliberately
 * short, and deliberately lives in one shared component.
 */
export function Scrim({
  onClick,
  onPointerDown,
  label,
  amount = 1,
  tone = "default",
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
  className?: string;
}) {
  const reduced = prefersReducedMotion();
  const hidden = { backgroundColor: "rgba(0,0,0,0)", backdropFilter: "blur(0px)" };
  const shown = {
    backgroundColor: `rgba(0,0,0,${(DIM[tone] * amount).toFixed(3)})`,
    backdropFilter: `blur(${Math.round(BLUR_PX * amount)}px)`,
  };

  const props = {
    initial: reduced ? { opacity: 0 } : hidden,
    animate: reduced ? { opacity: 1 } : shown,
    exit: {
      ...(reduced ? { opacity: 0 } : hidden),
      transition: { duration: motionTokens.standard, ease: motionTokens.easeInOut },
    },
    transition: { duration: motionTokens.emphasis, ease: motionTokens.ease },
    // The class is the no-JS/`@supports` floor; the animated values override it.
    className: cn(
      tone === "light" ? "overlay-scrim-light" : "overlay-scrim",
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
