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

function isStandaloneWindow(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches
  );
}

function screenExtent(): { screenWidth: number; screenHeight: number } {
  const s = window.screen;
  if (!s || !s.width || !s.height) return { screenWidth: 0, screenHeight: 0 };
  const long = Math.max(s.width, s.height);
  const short = Math.min(s.width, s.height);
  return window.matchMedia("(orientation: portrait)").matches
    ? { screenWidth: short, screenHeight: long }
    : { screenWidth: long, screenHeight: short };
}

function measureSafeInset(probe: HTMLElement): number {
  const raw = probe.getBoundingClientRect().height;
  return Math.max(0, Math.min(Math.round(raw), MAX_SAFE_BOTTOM));
}

/** How far a `position: fixed; bottom: 0` probe sits above the visual bottom. */
function measureChromeGap(visibleBottom: number, probe: HTMLElement): number {
  return Math.round(visibleBottom - probe.getBoundingClientRect().bottom);
}

/**
 * Publishes, on `<html>`:
 *  - `--keyboard-inset` / `--visible-height` — keyboard geometry
 *  - `--viewport-pan` / `--viewport-shrink` — keyboard-only chrome pins
 *  - `--safe-bottom` — tab-bar padding (env inset; never stripped because
 *    `screen.height` looked larger than the layout viewport)
 *
 * Resting chrome is never translated. A stale layout viewport is fixed the
 * same way navigating to Agenda always did: force `position: fixed` to
 * re-resolve, including a 1px scroll-and-back on pages that cannot scroll.
 */
export function useKeyboardInset() {
  const pathname = usePathname();
  const onRouteRef = useRef<() => void>(() => {});

  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;

    const gapProbe = document.createElement("div");
    gapProbe.setAttribute("aria-hidden", "true");
    gapProbe.style.cssText =
      "position:fixed;left:0;bottom:0;width:1px;height:0;visibility:hidden;pointer-events:none;";

    const safeProbe = document.createElement("div");
    safeProbe.setAttribute("aria-hidden", "true");
    safeProbe.style.cssText =
      "position:fixed;left:0;bottom:0;width:1px;height:0;padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none;box-sizing:content-box;";

    document.body.appendChild(gapProbe);
    document.body.appendChild(safeProbe);

    let keyboardBase: number | null = null;
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

    /** 1px scroll-and-back — the half of opening Agenda that unlocked the
     *  large viewport on pages that cannot scroll. Phone-only; skipped if
     *  the user has already scrolled. */
    const unlockShortViewport = () => {
      if (!phoneChrome()) return;
      if (window.scrollY !== 0) return;
      if (root.scrollHeight > root.clientHeight + 1) return;
      window.scrollTo(0, 1);
      window.scrollTo(0, 0);
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

    const apply = () => {
      const screen = screenExtent();
      const visibleHeight = vv ? vv.height : window.innerHeight;
      const offsetTop = vv ? vv.offsetTop : 0;
      const visibleBottom = offsetTop + visibleHeight;
      const metrics: ViewportMetrics = {
        layoutHeight: root.clientHeight,
        layoutWidth: root.clientWidth,
        innerHeight: window.innerHeight,
        chromeGap: measureChromeGap(Math.max(visibleBottom, window.innerHeight), gapProbe),
        visibleHeight,
        offsetTop,
        scale: vv ? vv.scale : 1,
        screenHeight: screen.screenHeight,
        screenWidth: screen.screenWidth,
        safeInset: measureSafeInset(safeProbe),
        standalone: isStandaloneWindow(),
        phoneChrome: phoneChrome(),
        typing: isTypingTarget(document.activeElement),
        keyboardBase,
        sinceLaunch: Date.now() - launchedAt,
      };

      const next = resolveViewportOffsets(metrics);
      keyboardBase = next.keyboardBase;

      root.style.setProperty("--safe-bottom", `${next.safeBottom}px`);
      root.style.setProperty("--visible-height", `${Math.round(visibleHeight)}px`);
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
      safeProbe.remove();
      onRouteRef.current = () => {};
      root.style.removeProperty("--safe-bottom");
      root.style.setProperty("--keyboard-inset", "0px");
      root.style.setProperty("--viewport-pan", "0px");
      root.style.setProperty("--viewport-shrink", "0px");
    };
  }, []);

  useEffect(() => {
    onRouteRef.current();
  }, [pathname]);
}
