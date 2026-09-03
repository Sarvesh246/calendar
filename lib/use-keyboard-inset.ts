"use client";

import { useEffect } from "react";
import { resolveViewportOffsets, type ViewportMetrics } from "@/lib/viewport-offsets";

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

/** Post-launch re-reads. iOS can still be settling its viewport well after the
 *  first paint — a cold PWA launch spends a second or more behind the splash
 *  screen — and it doesn't reliably announce the last of it, which left the
 *  first reading standing until something else (a route change) happened to
 *  fire an event. Pure re-measurement: it can only make `pan`/`shrink` reflect
 *  the current, honest geometry sooner, never invent a correction that reading
 *  once at mount wouldn't already justify. Runs from mount and again on every
 *  resume. */
const SETTLE_MS = [50, 150, 400, 800, 1500, 3000];

/**
 * Publishes, on `<html>`:
 *  - `--keyboard-inset`: the slice of the layout viewport currently hidden below
 *    the visible area — the keyboard **plus** any distance iOS has panned the
 *    page up to reveal the focused field. Anything anchored to the bottom can add
 *    this to stay glued just above the keyboard no matter how iOS shifts things.
 *  - `--visible-height`: the height actually visible above the keyboard.
 *  - `--viewport-pan` / `--viewport-shrink`: how far the app's own fixed chrome
 *    (tab bar, FAB, header cluster) has to be pushed back down to stay welded to
 *    the device window while the keyboard is up — see below.
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

    // Layout-viewport height from just before the keyboard opened, captured on
    // `focusin` (see below). Null whenever no keyboard is up.
    let keyboardBase: number | null = null;

    let raf = 0;
    const apply = () => {
      raf = 0;
      const typing = isTypingTarget(document.activeElement);
      const layoutHeight = root.clientHeight;

      root.style.setProperty("--visible-height", `${Math.round(vv.height)}px`);

      const metrics: ViewportMetrics = {
        layoutHeight,
        visibleHeight: vv.height,
        offsetTop: vv.offsetTop,
        scale: vv.scale,
        typing,
        keyboardBase,
      };
      const next = resolveViewportOffsets(metrics);
      keyboardBase = next.keyboardBase;

      // Two different things move a `position: fixed` element off the window
      // when the keyboard opens, and which one you get depends on the browser:
      //
      //  - pan: iOS scrolls the *visual* viewport up inside an unchanged layout
      //    viewport to reveal the focused field. Fixed elements are laid out
      //    against the layout viewport, so they ride the pan — the bottom tab
      //    bar climbs up and floats above the keyboard, and it stays there until
      //    iOS unwinds the pan on its own schedule, well after the sheet that
      //    opened the keyboard has gone.
      //  - shrink: browsers that resize the layout viewport instead (iOS
      //    standalone, `interactive-widget: resizes-content`) lift bottom-
      //    anchored chrome by the keyboard's height in one jump.
      //
      // Both are published as the distance to push chrome back *down*, so one
      // rule pins it to the real window edge either way and the page keeps
      // running behind the keyboard instead of detaching from it.
      root.style.setProperty("--viewport-pan", `${next.pan}px`);
      root.style.setProperty("--viewport-shrink", `${next.shrink}px`);
      root.style.setProperty("--keyboard-inset", `${next.keyboardInset}px`);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };

    let timers: ReturnType<typeof setTimeout>[] = [];
    /** Re-read across the window in which a launch-time reading can still be
     *  wrong, so none of it depends on an event the browser may never send. */
    const settle = () => {
      apply();
      SETTLE_MS.forEach((ms) => timers.push(setTimeout(schedule, ms)));
    };

    const onFocusIn = () => {
      // Taken the instant focus lands, before the keyboard has had a chance to
      // resize anything, so it is honestly the pre-keyboard height. Reading it
      // off a viewport event instead was a race: if the resize arrived first —
      // or before `document.activeElement` had caught up — the "resting" height
      // was recorded as the already-shrunken one and the correction silently
      // did nothing for the rest of that keyboard session. Only the first field
      // of a session sets it; moving between fields must not re-baseline
      // against a viewport the keyboard has already shortened.
      if (keyboardBase === null && isTypingTarget(document.activeElement)) {
        keyboardBase = root.clientHeight;
      }
      schedule();
    };
    // focusout fires before the keyboard animates away, and the last viewport
    // event can land before the browser has finished handing the shift back.
    const onFocusOut = () => {
      schedule();
      timers.push(setTimeout(schedule, 250), setTimeout(schedule, 500));
    };
    const onResume = () => {
      if (document.visibilityState === "hidden") return;
      settle();
    };

    settle();

    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("focusout", onFocusOut);
    // Belt and braces against a reading going stale with no viewport event to
    // correct it: rotation, and a PWA resumed from the background.
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.addEventListener("pageshow", onResume);
    document.addEventListener("visibilitychange", onResume);
    // The layout viewport can change size without a `resize` event; this is the
    // one signal that always fires when it does.
    const ro = new ResizeObserver(schedule);
    ro.observe(root);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      timers = [];
      ro.disconnect();
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.removeEventListener("pageshow", onResume);
      document.removeEventListener("visibilitychange", onResume);
      root.style.setProperty("--keyboard-inset", "0px");
      root.style.setProperty("--viewport-pan", "0px");
      root.style.setProperty("--viewport-shrink", "0px");
    };
  }, []);
}
