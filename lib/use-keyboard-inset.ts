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

    // Layout-viewport height with no keyboard up. Only re-read while nothing is
    // focused, so a browser that *does* shrink the layout viewport for the
    // keyboard can't quietly redefine "normal" mid-edit.
    let restingHeight = root.clientHeight;

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
      //    bar climbs up and ends up floating above the keyboard, and it stays
      //    there until iOS unwinds the pan on its own schedule (well after the
      //    sheet that opened the keyboard has gone).
      //  - shrink: browsers that resize the layout viewport instead (iOS
      //    standalone, `interactive-widget: resizes-content`) lift bottom-
      //    anchored chrome by the keyboard's height in one jump.
      //
      // Publishing both as the distance to push chrome back *down* lets one
      // rule pin it to the real window edge either way, so the page keeps
      // running behind the keyboard instead of detaching from it. Deliberately
      // pure geometry, not gated on focus: on blur the keyboard is still on
      // screen for a few hundred ms, and zeroing early would make the chrome
      // jump ahead of it.
      // Skipped while pinch-zoomed: there the offset is a pan the *user* chose,
      // and at scale != 1 a CSS-pixel correction wouldn't land on the window
      // edge anyway. At scale 1 the only thing that offsets the visual viewport
      // is the browser getting out of the keyboard's way.
      const pan = vv.scale > 1.01 ? 0 : Math.max(0, Math.round(vv.offsetTop));
      root.style.setProperty("--viewport-pan", `${pan}px`);

      if (!typing) restingHeight = layoutHeight;
      // Clamped to the visible height so a stale resting height (rotating the
      // device mid-edit) can never shove the chrome off the bottom for good.
      const shrink = Math.min(Math.max(0, restingHeight - layoutHeight), Math.round(vv.height));
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
    // focusout fires before the keyboard animates away, and the last visual
    // viewport event can land before iOS has finished handing the pan back;
    // re-check a couple of beats later so nothing is left offset.
    const timers: ReturnType<typeof setTimeout>[] = [];
    const onFocusOut = () => {
      schedule();
      timers.push(setTimeout(schedule, 250), setTimeout(schedule, 500));
    };

    apply();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    window.addEventListener("focusin", schedule);
    window.addEventListener("focusout", onFocusOut);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      window.removeEventListener("focusin", schedule);
      window.removeEventListener("focusout", onFocusOut);
      root.style.setProperty("--keyboard-inset", "0px");
      root.style.setProperty("--viewport-pan", "0px");
      root.style.setProperty("--viewport-shrink", "0px");
    };
  }, []);
}
