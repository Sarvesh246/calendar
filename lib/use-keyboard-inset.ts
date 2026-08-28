"use client";

import { useEffect } from "react";

const NON_TEXT_INPUT = new Set([
  "checkbox",
  "radio",
  "range",
  "color",
  "button",
  "submit",
  "reset",
  "file",
  "image",
]);

/** Is the focused element one that raises the on-screen keyboard? */
function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  if (el.tagName === "TEXTAREA") return true;
  if (el.tagName === "INPUT") return !NON_TEXT_INPUT.has((el as HTMLInputElement).type);
  return (el as HTMLElement).isContentEditable;
}

/**
 * Publishes the on-screen keyboard's height as the `--keyboard-inset` CSS
 * variable on <html>.
 *
 * iOS Safari doesn't shrink the layout viewport when the virtual keyboard opens
 * (it only shrinks the *visual* viewport), so `position: fixed` UI anchored to
 * the bottom — the AI drawer, the command palette — would sit behind the
 * keyboard. Reading `var(--keyboard-inset)` lets that chrome lift itself clear so
 * the field you're typing in, and what you're typing, stay visible.
 *
 * The height is measured as how far `visualViewport` shrinks *from its own
 * resting size* (recaptured whenever nothing is focused), so a constant
 * visual/layout-viewport offset — browser UI, a hardware keyboard, dev tools —
 * never registers as a keyboard.
 */
export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    if (!vv) return;

    let resting = vv.height;
    let raf = 0;

    const apply = () => {
      raf = 0;
      if (!isTypingTarget(document.activeElement)) {
        resting = vv.height; // keep the baseline fresh across rotation / toolbar changes
        root.style.setProperty("--keyboard-inset", "0px");
        return;
      }
      const shrink = resting - vv.height;
      if (shrink < 0) resting = vv.height; // viewport grew past the baseline — re-anchor
      root.style.setProperty("--keyboard-inset", `${shrink > 40 ? Math.round(shrink) : 0}px`);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    // focusout fires before the keyboard animates away; re-check a beat later.
    const onFocusOut = () => {
      schedule();
      setTimeout(schedule, 250);
    };

    apply();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    window.addEventListener("focusin", schedule);
    window.addEventListener("focusout", onFocusOut);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      window.removeEventListener("focusin", schedule);
      window.removeEventListener("focusout", onFocusOut);
      root.style.setProperty("--keyboard-inset", "0px");
    };
  }, []);
}
