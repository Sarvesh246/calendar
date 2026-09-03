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

/** Post-mount re-reads. iOS can still be settling its viewport after the first
 *  paint — especially on a cold PWA launch — and it doesn't always announce the
 *  last of it, which left the first reading standing until something else (a
 *  route change scrolling to top) happened to fire an event. */
const SETTLE_MS = [50, 150, 400, 800, 1500];

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

      // Nothing is covering the window unless the visible area is shorter than
      // the layout viewport — and a visual viewport that fills its layout
      // viewport cannot be offset within it. Gating on that geometry, rather
      // than on a remembered value or on which element has focus, is what
      // guarantees the chrome sits exactly where the layout puts it whenever no
      // keyboard is up: a stale, mistimed or plain wrong reading can shift it
      // *while* the keyboard is up, but can never leave it displaced at rest.
      const covered = vv.height < layoutHeight - 1;
      // Skipped while pinch-zoomed: there the offset is a pan the *user* chose,
      // and at scale != 1 a CSS-pixel correction wouldn't land on the window
      // edge anyway.
      const pan = covered && vv.scale <= 1.01 ? Math.max(0, Math.round(vv.offsetTop)) : 0;
      root.style.setProperty("--viewport-pan", `${pan}px`);

      // Released on the same geometric test rather than on blur — the keyboard
      // is still on screen for a few hundred ms after focus leaves, and dropping
      // the correction early would make the chrome jump ahead of it.
      if (keyboardBase !== null && !typing && layoutHeight >= keyboardBase) keyboardBase = null;
      const shrink =
        keyboardBase === null
          ? 0
          : Math.min(Math.max(0, keyboardBase - layoutHeight), layoutHeight);
      root.style.setProperty("--viewport-shrink", `${shrink}px`);

      if (!typing) {
        root.style.setProperty("--keyboard-inset", "0px");
        return;
      }
      const hidden = layoutHeight - vv.height - vv.offsetTop;
      root.style.setProperty("--keyboard-inset", `${hidden > 1 ? Math.round(hidden) : 0}px`);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };

    const timers: ReturnType<typeof setTimeout>[] = [];
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

    apply();
    SETTLE_MS.forEach((ms) => timers.push(setTimeout(schedule, ms)));

    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("focusout", onFocusOut);
    // Belt and braces against a reading going stale with no viewport event to
    // correct it: rotation, and a PWA resumed from the background.
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.addEventListener("pageshow", schedule);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.removeEventListener("pageshow", schedule);
      document.removeEventListener("visibilitychange", schedule);
      root.style.setProperty("--keyboard-inset", "0px");
      root.style.setProperty("--viewport-pan", "0px");
      root.style.setProperty("--viewport-shrink", "0px");
    };
  }, []);
}
