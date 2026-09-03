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
 *  screen — and it doesn't reliably announce the last of it. Runs from mount
 *  and again on every resume. */
const SETTLE_MS = [0, 50, 120, 250, 400, 700, 1000, 1500, 2200, 3000, 4500, 6000, 8000, 10000];

/** Relayout nudges are cheap but not free; a handful per launch is plenty. */
const MAX_NUDGES = 10;
const NUDGE_SPACING_MS = 150;

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

/** How far a `position: fixed; bottom: 0` probe sits above the window bottom. */
function measureChromeGap(vv: VisualViewport, probe: HTMLElement): number {
  const bottom = probe.getBoundingClientRect().bottom;
  const target = Math.max(vv.offsetTop + vv.height, window.innerHeight);
  return Math.round(target - bottom);
}

/** Runtime safe-area read, capped to the same ceiling as the CSS fallback. */
function measureSafeBottom(probe: HTMLElement): number {
  const raw = probe.getBoundingClientRect().height;
  return Math.max(0, Math.min(Math.round(raw), 60));
}

/**
 * Publishes, on `<html>`:
 *  - `--keyboard-inset`: hidden area below the visible viewport (keyboard + pan)
 *  - `--visible-height`: height visible above the keyboard
 *  - `--viewport-pan` / `--viewport-shrink` / `--viewport-underflow`: fixed-chrome
 *    corrections — see `lib/viewport-offsets.ts`
 */
export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    if (!vv) return;

    const gapProbe = document.createElement("div");
    gapProbe.setAttribute("aria-hidden", "true");
    gapProbe.style.cssText =
      "position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden;pointer-events:none;";

    const safeProbe = document.createElement("div");
    safeProbe.setAttribute("aria-hidden", "true");
    safeProbe.style.cssText =
      "position:fixed;left:0;bottom:0;width:0;height:0;padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none;box-sizing:content-box;";

    document.body.appendChild(gapProbe);
    document.body.appendChild(safeProbe);

    let keyboardBase: number | null = null;
    let launchedAt = Date.now();
    let nudges = 0;
    let lastNudge = 0;

    /** Force a real layout pass — the part of "navigate to another tab" that
     *  actually fixed the launch bug. Undone within the same task. */
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
        innerHeight: window.innerHeight,
        chromeGap: measureChromeGap(vv, gapProbe),
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

      root.style.setProperty("--safe-bottom", `${measureSafeBottom(safeProbe)}px`);
      root.style.setProperty("--visible-height", `${Math.round(vv.height)}px`);
      root.style.setProperty("--viewport-pan", `${next.pan}px`);
      root.style.setProperty("--viewport-shrink", `${next.shrink}px`);
      root.style.setProperty("--viewport-underflow", `${next.underflow}px`);
      root.style.setProperty("--keyboard-inset", `${next.keyboardInset}px`);

      if (next.needsRelayout) nudgeRelayout();
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };

    let timers: ReturnType<typeof setTimeout>[] = [];
    const settle = () => {
      launchedAt = Date.now();
      nudges = 0;
      apply();
      SETTLE_MS.forEach((ms) =>
        timers.push(
          setTimeout(() => {
            schedule();
            nudgeRelayout();
          }, ms)
        )
      );
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

    settle();

    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("focusout", onFocusOut);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.addEventListener("pageshow", onResume);
    document.addEventListener("visibilitychange", onResume);
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
      gapProbe.remove();
      safeProbe.remove();
      root.style.removeProperty("--safe-bottom");
      root.style.setProperty("--keyboard-inset", "0px");
      root.style.setProperty("--viewport-pan", "0px");
      root.style.setProperty("--viewport-shrink", "0px");
      root.style.setProperty("--viewport-underflow", "0px");
    };
  }, []);
}
