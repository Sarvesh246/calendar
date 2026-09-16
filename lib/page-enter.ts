"use client";

import { useLayoutEffect, useRef } from "react";
import { prefersReducedMotion } from "./motion";

export const PAGE_ENTER_CLASS = "tab-page-enter";

let skipEnter = false;

/** Horizontal page swipes already carry the incoming view — skip the fade. */
export function skipNextPageEnter() {
  skipEnter = true;
}

export function takeSkipPageEnter() {
  const value = skipEnter;
  skipEnter = false;
  return value;
}

/**
 * Restarts a short CSS enter whenever `key` changes. Replacing the class
 * (instead of stacking AnimatePresence) means a spam of tab taps retriggers
 * the same ~140ms fade — nothing queues, nothing crossfades.
 */
export function usePageEnter(key: string | null, enabled = true) {
  const ref = useRef<HTMLElement | null>(null);
  const seen = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !key || !enabled) {
      if (key) seen.current = key;
      return;
    }
    const first = seen.current === null;
    const unchanged = seen.current === key;
    seen.current = key;
    const skip = takeSkipPageEnter();
    if (first || unchanged || skip || prefersReducedMotion()) return;

    el.classList.remove(PAGE_ENTER_CLASS);
    // Force a style recalc so the animation can replay on a spam tap.
    void el.offsetWidth;
    el.classList.add(PAGE_ENTER_CLASS);
    const clear = () => el.classList.remove(PAGE_ENTER_CLASS);
    el.addEventListener("animationend", clear, { once: true });
    return () => el.removeEventListener("animationend", clear);
  }, [key, enabled]);

  return ref;
}
