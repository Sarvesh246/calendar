"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  LAUNCH_WINDOW_MS,
  MAX_SAFE_BOTTOM,
  resolveViewportOffsets,
  type ViewportMetrics,
} from "@/lib/viewport-offsets";

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

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  if (el.tagName === "TEXTAREA") return true;
  if (el.tagName === "INPUT") return !NON_TEXT_INPUT.has((el as HTMLInputElement).type);
  return (el as HTMLElement).isContentEditable;
}

/** Re-read as iOS finishes applying `viewport-fit: cover` after a cold launch
 *  or a resume. The interesting readings happen well after first paint. */
const SETTLE_MS = [0, 50, 150, 400, 800, 1500, 3000, 5000, 8000];

const MAX_NUDGES = 8;
const NUDGE_SPACING_MS = 200;

/** How many times one pass may re-measure while `--fixed-drop` is still
 *  moving. Reading a rect flushes layout, so the correction converges inside
 *  a single frame instead of stepping towards the right place over several. */
const MAX_DROP_PASSES = 4;

function isStandaloneWindow(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches
  );
}

function measureSafeInset(probe: HTMLElement): number {
  const raw = probe.getBoundingClientRect().height;
  return Math.max(0, Math.min(Math.round(raw), MAX_SAFE_BOTTOM));
}

/** The padding under the tab pill, in CSS pixels, measured rather than parsed
 *  — custom properties come back as their specified token (`0.75rem`), not a
 *  used length. That padding is the whole budget `--fixed-drop` has before it
 *  starts pushing visible chrome past the fixed layer's clip. */
function measureDropHeadroom(probe: HTMLElement): number {
  return Math.max(0, Math.round(probe.getBoundingClientRect().height));
}

/**
 * Publishes, on `<html>`:
 *  - `--keyboard-inset` / `--visible-height` — keyboard geometry
 *  - `--viewport-pan` / `--viewport-shrink` — keyboard-only chrome pins
 *  - `--safe-bottom` — the `env()` bottom inset, never stripped
 *  - `--fixed-drop` — how far bottom chrome has to come back down to reach the
 *    real window edge while iOS is still reporting a short layout viewport
 *  - `--window-height` — the real window height, hung on the page box as a
 *    `min-height` so a stale layout viewport is overflowed
 *
 * `--fixed-drop` is a measured residual, not a guess: the `bottom: 0` probe
 * carries the variable, so each pass reads what the current correction has not
 * accounted for and the value settles on its own — including back to 0 when
 * WebKit finally publishes the real window.
 *
 * `--window-height` is what makes that happen rather than waiting for it.
 * WebKit clips fixed chrome to the layout viewport, so the drop can only ever
 * spend the tab bar's own bottom padding; the actual cure is to overflow the
 * short viewport, which is all Agenda was ever doing.
 */
export function useKeyboardInset() {
  const pathname = usePathname();
  const onRouteRef = useRef<() => void>(() => {});

  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;

    // Where `position: fixed; bottom: 0` actually lands. Carries --fixed-drop
    // so it reports the *residual* error, exactly like the tab bar does.
    const gapProbe = document.createElement("div");
    gapProbe.setAttribute("aria-hidden", "true");
    gapProbe.style.cssText =
      "position:fixed;left:0;bottom:0;width:1px;height:0;visibility:hidden;pointer-events:none;translate:0 var(--fixed-drop,0px);";

    // Where the real window bottom is. `100vh` is the one length WebKit gets
    // right from a cold standalone launch — `100dvh`, `-webkit-fill-available`
    // and `clientHeight` are all still short at that point.
    const vhProbe = document.createElement("div");
    vhProbe.setAttribute("aria-hidden", "true");
    vhProbe.style.cssText =
      "position:fixed;left:0;top:0;width:1px;height:100vh;visibility:hidden;pointer-events:none;";

    const safeProbe = document.createElement("div");
    safeProbe.setAttribute("aria-hidden", "true");
    safeProbe.style.cssText =
      "position:fixed;left:0;bottom:0;width:1px;height:0;padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none;box-sizing:content-box;";

    // Mirrors the tab bar's own padding, so the drop's ceiling is the real
    // one rather than a number copied out of the stylesheet.
    const headroomProbe = document.createElement("div");
    headroomProbe.setAttribute("aria-hidden", "true");
    headroomProbe.style.cssText =
      "position:fixed;left:0;bottom:0;width:1px;height:0;padding-bottom:calc(var(--safe-bottom,0px) + var(--tab-bar-rest,0px));visibility:hidden;pointer-events:none;box-sizing:content-box;";

    document.body.appendChild(gapProbe);
    document.body.appendChild(vhProbe);
    document.body.appendChild(safeProbe);
    document.body.appendChild(headroomProbe);

    /** Gates the `min-height` rules in globals.css. An attribute rather than a
     *  `display-mode` media query because iOS home-screen apps predating
     *  16.4 only ever admit to `navigator.standalone`. */
    const syncStandaloneFlag = () => {
      if (isStandaloneWindow()) root.setAttribute("data-standalone", "1");
      else root.removeAttribute("data-standalone");
    };
    syncStandaloneFlag();

    let keyboardBase: number | null = null;
    let fixedDrop = Number.parseFloat(
      getComputedStyle(root).getPropertyValue("--fixed-drop")
    );
    if (!Number.isFinite(fixedDrop)) fixedDrop = 0;
    let launchedAt = Date.now();
    let nudges = 0;
    let lastNudge = 0;

    const phoneChrome = () => window.matchMedia("(max-width: 767px)").matches;

    /** Re-resolve `position: fixed` without painting a displaced frame. */
    const reflowFixedChrome = () => {
      root.style.paddingBottom = "0.02px";
      void root.offsetHeight;
      root.style.paddingBottom = "";
      void root.offsetHeight;
    };

    /** A 1px scroll-and-back — the half of opening Agenda that made WebKit
     *  publish the real window. On a page with no scroll range the old version
     *  was a no-op, which is exactly why Today and Calendar never recovered on
     *  their own; lend the document a pixel of range for the round trip. */
    const unlockShortViewport = () => {
      if (!phoneChrome()) return;
      if (window.scrollY !== 0) return;
      if (root.scrollHeight > root.clientHeight + 1) {
        window.scrollTo(0, 1);
        window.scrollTo(0, 0);
        return;
      }
      // Max, not clientHeight: `--window-height` may already be holding the
      // page box taller than the viewport, and lending from below would
      // shrink it for a frame.
      const before = root.style.minHeight;
      root.style.minHeight = `${Math.max(root.scrollHeight, root.clientHeight) + 1}px`;
      void root.offsetHeight;
      window.scrollTo(0, 1);
      window.scrollTo(0, 0);
      root.style.minHeight = before;
      void root.offsetHeight;
    };

    /**
     * The part of "switch to Agenda and the bar drops into place" that
     * actually fixed it. Never a translate.
     */
    const nudgeRelayout = () => {
      const now = Date.now();
      if (nudges >= MAX_NUDGES || now - lastNudge < NUDGE_SPACING_MS) return;
      if (now - launchedAt > LAUNCH_WINDOW_MS) return;
      nudges += 1;
      lastNudge = now;
      reflowFixedChrome();
      unlockShortViewport();
    };

    const readMetrics = (): ViewportMetrics => {
      const visibleHeight = vv ? vv.height : window.innerHeight;
      const offsetTop = vv ? vv.offsetTop : 0;
      // The window bottom in client coordinates. All three readings agree once
      // the viewport has settled; before that whichever is largest is the one
      // WebKit has already updated.
      const windowBottom = Math.max(
        vhProbe.getBoundingClientRect().bottom,
        offsetTop + visibleHeight,
        window.innerHeight
      );
      return {
        layoutHeight: root.clientHeight,
        visibleHeight,
        offsetTop,
        scale: vv ? vv.scale : 1,
        fixedGap: Math.round(windowBottom - gapProbe.getBoundingClientRect().bottom),
        fixedDrop,
        dropHeadroom: measureDropHeadroom(headroomProbe),
        windowHeight: Math.round(windowBottom),
        safeInset: measureSafeInset(safeProbe),
        standalone: isStandaloneWindow(),
        phoneChrome: phoneChrome(),
        typing: isTypingTarget(document.activeElement),
        keyboardBase,
        sinceLaunch: Date.now() - launchedAt,
      };
    };

    const apply = () => {
      let metrics = readMetrics();
      let next = resolveViewportOffsets(metrics);

      // Reading a rect flushes layout, so writing --fixed-drop and measuring
      // again lands the bar in one frame rather than creeping towards it.
      for (let pass = 1; pass < MAX_DROP_PASSES; pass += 1) {
        if (next.fixedDrop === fixedDrop) break;
        fixedDrop = next.fixedDrop;
        root.style.setProperty("--fixed-drop", `${fixedDrop}px`);
        metrics = readMetrics();
        next = resolveViewportOffsets(metrics);
      }

      keyboardBase = next.keyboardBase;
      fixedDrop = next.fixedDrop;

      root.style.setProperty("--fixed-drop", `${fixedDrop}px`);
      if (next.windowHeight > 0) {
        root.style.setProperty("--window-height", `${next.windowHeight}px`);
      }
      root.style.setProperty("--safe-bottom", `${next.safeBottom}px`);
      root.style.setProperty("--visible-height", `${Math.round(metrics.visibleHeight)}px`);
      root.style.setProperty("--viewport-pan", `${next.pan}px`);
      root.style.setProperty("--viewport-shrink", `${next.shrink}px`);
      root.style.setProperty("--keyboard-inset", `${next.keyboardInset}px`);

      if (next.needsRelayout) nudgeRelayout();
    };

    let raf = 0;
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0;
        apply();
      });
    };

    let timers: ReturnType<typeof setTimeout>[] = [];
    const settle = () => {
      timers.forEach(clearTimeout);
      timers = [];
      launchedAt = Date.now();
      nudges = 0;
      lastNudge = 0;
      syncStandaloneFlag();
      apply();
      SETTLE_MS.forEach((ms) => timers.push(setTimeout(schedule, ms)));
    };

    const onFocusIn = () => {
      if (keyboardBase === null && isTypingTarget(document.activeElement)) {
        keyboardBase = root.clientHeight;
      }
      schedule();
    };
    const onFocusOut = () => {
      schedule();
      timers.push(setTimeout(schedule, 250), setTimeout(schedule, 500));
    };
    const onResume = () => {
      if (document.visibilityState === "hidden") return;
      settle();
    };
    const onOrientation = () => {
      settle();
    };

    onRouteRef.current = () => {
      // Route changes are what made Agenda the only screen that looked right.
      // One extra layout pass on every tab, not only the one long enough to
      // scroll. Does not reset the launch window — that would re-arm the
      // 1px scroll on a page the user may have already scrolled.
      apply();
      reflowFixedChrome();
      unlockShortViewport();
      schedule();
    };

    settle();

    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("focusout", onFocusOut);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", onOrientation);
    window.addEventListener("pageshow", onResume);
    document.addEventListener("visibilitychange", onResume);
    const ro = new ResizeObserver(schedule);
    ro.observe(root);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      timers = [];
      ro.disconnect();
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", onOrientation);
      window.removeEventListener("pageshow", onResume);
      document.removeEventListener("visibilitychange", onResume);
      gapProbe.remove();
      vhProbe.remove();
      safeProbe.remove();
      headroomProbe.remove();
      onRouteRef.current = () => {};
      root.style.removeProperty("--safe-bottom");
      root.style.removeProperty("--window-height");
      root.style.setProperty("--fixed-drop", "0px");
      root.style.setProperty("--keyboard-inset", "0px");
      root.style.setProperty("--viewport-pan", "0px");
      root.style.setProperty("--viewport-shrink", "0px");
    };
  }, []);

  useEffect(() => {
    onRouteRef.current();
  }, [pathname]);
}
