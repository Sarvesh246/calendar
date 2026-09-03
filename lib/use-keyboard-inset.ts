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
 *  fire an event. Runs from mount and again on every resume. */
const SETTLE_MS = [0, 50, 120, 250, 400, 700, 1000, 1500, 2200, 3000, 4500, 6000];

/** Relayout nudges are cheap but not free; a handful per launch is plenty to
 *  cover a viewport that settles in stages, and the correction below holds the
 *  chrome in place in the meantime either way. */
const MAX_NUDGES = 6;
const NUDGE_SPACING_MS = 200;

function isStandaloneWindow(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches
  );
}

/** Screen extent in CSS pixels, matched to the current orientation. iOS does
 *  not consistently swap `screen.width`/`screen.height` on rotation, so the
 *  orientation media query decides which is which rather than the order they
 *  come in. */
function screenExtent(): { screenWidth: number; screenHeight: number } {
  const s = window.screen;
  if (!s || !s.width || !s.height) return { screenWidth: 0, screenHeight: 0 };
  const long = Math.max(s.width, s.height);
  const short = Math.min(s.width, s.height);
  return window.matchMedia("(orientation: portrait)").matches
    ? { screenWidth: short, screenHeight: long }
    : { screenWidth: long, screenHeight: short };
}

/**
 * Publishes, on `<html>`:
 *  - `--keyboard-inset`: the slice of the layout viewport currently hidden below
 *    the visible area — the keyboard **plus** any distance iOS has panned the
 *    page up to reveal the focused field. Anything anchored to the bottom can add
 *    this to stay glued just above the keyboard no matter how iOS shifts things.
 *  - `--visible-height`: the height actually visible above the keyboard.
 *  - `--viewport-pan` / `--viewport-shrink` / `--viewport-underflow`: how far the
 *    app's own fixed chrome (tab bar, FAB, header cluster) has to be pushed back
 *    down to stay welded to the device window — see `lib/viewport-offsets.ts`,
 *    which holds the geometry and the reasoning for each term.
 *
 * iOS never shrinks the layout viewport for the keyboard in a browser tab (only
 * the *visual* viewport), and it also scrolls the visual viewport — so
 * `documentElement.clientHeight - visualViewport.height - visualViewport.offsetTop`
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

    // Reset on every resume as well as at mount: a PWA brought back from the
    // background goes through the same "viewport is still settling" window a
    // cold launch does.
    let launchedAt = Date.now();
    let nudges = 0;
    let lastNudge = 0;

    /**
     * Force a real layout pass, which is the part of "navigate to another tab
     * and it fixes itself" that actually fixed it.
     *
     * `position: fixed` is resolved against the layout viewport when the
     * element is laid out. If the browser has since corrected a viewport it got
     * wrong at launch, the chrome does not move until something lays it out
     * again — and on a cold launch nothing does, because the page has finished
     * loading and nobody has touched it. Toggling a layout-affecting property
     * on `<html>` and reading back a layout property makes the pass happen now;
     * the scroll is the other half of what a route change did. Both are undone
     * within the same task, so nothing is ever painted in the nudged state.
     */
    const nudgeRelayout = () => {
      const now = Date.now();
      if (nudges >= MAX_NUDGES || now - lastNudge < NUDGE_SPACING_MS) return;
      nudges += 1;
      lastNudge = now;

      const y = window.scrollY;
      root.style.paddingBottom = "0.02px";
      void root.offsetHeight;
      root.style.paddingBottom = "";
      void root.offsetHeight;
      if (y === 0) {
        // A no-op on a page that can't scroll, which is exactly the case where
        // no viewport event was ever going to arrive on its own.
        window.scrollTo(0, 1);
        window.scrollTo(0, 0);
      }
    };

    let raf = 0;
    const apply = () => {
      raf = 0;
      const screen = screenExtent();
      const metrics: ViewportMetrics = {
        layoutHeight: root.clientHeight,
        layoutWidth: root.clientWidth,
        visibleHeight: vv.height,
        offsetTop: vv.offsetTop,
        scale: vv.scale,
        screenHeight: screen.screenHeight,
        screenWidth: screen.screenWidth,
        standalone: isStandaloneWindow(),
        phoneChrome: window.matchMedia("(max-width: 767px)").matches,
        typing: isTypingTarget(document.activeElement),
        keyboardBase,
        sinceLaunch: Date.now() - launchedAt,
      };

      const next = resolveViewportOffsets(metrics);
      keyboardBase = next.keyboardBase;

      root.style.setProperty("--visible-height", `${Math.round(vv.height)}px`);
      root.style.setProperty("--viewport-pan", `${next.pan}px`);
      root.style.setProperty("--viewport-shrink", `${next.shrink}px`);
      root.style.setProperty("--viewport-underflow", `${next.underflow}px`);
      root.style.setProperty("--keyboard-inset", `${next.keyboardInset}px`);

      // The correction above already has the chrome sitting where it belongs,
      // so this is only ever an attempt to make it unnecessary: if the browser
      // takes the hint and re-resolves against the real window, the next pass
      // measures no gap and the correction dissolves on its own.
      if (next.needsRelayout) nudgeRelayout();
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };

    let timers: ReturnType<typeof setTimeout>[] = [];
    /** Re-read across the window in which a launch-time reading can still be
     *  wrong, so none of it depends on an event the browser may never send. */
    const settle = () => {
      launchedAt = Date.now();
      nudges = 0;
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
    // The layout viewport can change size without a `resize` event — the
    // launch-time correction is precisely the case where the browser fixes its
    // own viewport quietly — and this is the one signal that always fires when
    // it does.
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
      root.style.setProperty("--viewport-underflow", "0px");
    };
  }, []);
}
