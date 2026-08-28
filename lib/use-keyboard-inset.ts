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
 * Publishes, on `<html>`:
 *  - `--keyboard-inset`: the slice of the layout viewport currently hidden below
 *    the visible area — the keyboard **plus** any distance iOS has panned the
 *    page up to reveal the focused field. Anything anchored to the bottom can add
 *    this to stay glued just above the keyboard no matter how iOS shifts things.
 *  - `--visible-height`: the height actually visible above the keyboard.
 *
 * iOS never shrinks the layout viewport for the keyboard (only the *visual*
 * viewport), and it also scrolls the visual viewport — so `document.
 * documentElement.clientHeight - visualViewport.height - visualViewport.offsetTop`
 * is the honest "how much is hidden right now" figure, self-correcting for the
 * pan. It's clamped to 0 unless a text field is focused.
 */
export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    if (!vv) return;

    let raf = 0;
    const apply = () => {
      raf = 0;
      root.style.setProperty("--visible-height", `${Math.round(vv.height)}px`);
      if (!isTypingTarget(document.activeElement)) {
        root.style.setProperty("--keyboard-inset", "0px");
        return;
      }
      const hidden = root.clientHeight - vv.height - vv.offsetTop;
      root.style.setProperty("--keyboard-inset", `${hidden > 1 ? Math.round(hidden) : 0}px`);
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
