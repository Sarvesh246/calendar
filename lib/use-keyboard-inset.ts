"use client";

import { useEffect } from "react";
import { MAX_SAFE_BOTTOM, resolveViewportOffsets, type ViewportMetrics } from "@/lib/viewport-offsets";

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
 *  or a resume. Measurement only — never a layout nudge or a translate. */
const SETTLE_MS = [0, 50, 150, 400, 800, 1500, 3000];

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

/**
 * Publishes, on `<html>`:
 *  - `--keyboard-inset` / `--visible-height` — keyboard geometry
 *  - `--viewport-pan` / `--viewport-shrink` — keyboard-only chrome pins
 *  - `--safe-bottom` — tab-bar padding, reduced when the layout viewport
 *    already excludes the home indicator so `env()` cannot lift it twice
 *
 * Resting chrome is never translated and the document is never scrolled
 * as a side effect. Those two were what pushed the tab bar under the
 * screen after hydration and again on a tab switch.
 */
export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    if (!vv) return;

    const safeProbe = document.createElement("div");
    safeProbe.setAttribute("aria-hidden", "true");
    safeProbe.style.cssText =
      "position:fixed;left:0;bottom:0;width:0;height:0;padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none;box-sizing:content-box;";
    document.body.appendChild(safeProbe);

    let keyboardBase: number | null = null;

    let raf = 0;
    const apply = () => {
      raf = 0;
      const screen = screenExtent();
      const metrics: ViewportMetrics = {
        layoutHeight: root.clientHeight,
        layoutWidth: root.clientWidth,
        innerHeight: window.innerHeight,
        visibleHeight: vv.height,
        offsetTop: vv.offsetTop,
        scale: vv.scale,
        screenHeight: screen.screenHeight,
        screenWidth: screen.screenWidth,
        safeInset: measureSafeInset(safeProbe),
        standalone: isStandaloneWindow(),
        phoneChrome: window.matchMedia("(max-width: 767px)").matches,
        typing: isTypingTarget(document.activeElement),
        keyboardBase,
      };

      const next = resolveViewportOffsets(metrics);
      keyboardBase = next.keyboardBase;

      root.style.setProperty("--safe-bottom", `${next.safeBottom}px`);
      root.style.setProperty("--visible-height", `${Math.round(vv.height)}px`);
      root.style.setProperty("--viewport-pan", `${next.pan}px`);
      root.style.setProperty("--viewport-shrink", `${next.shrink}px`);
      root.style.setProperty("--keyboard-inset", `${next.keyboardInset}px`);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };

    let timers: ReturnType<typeof setTimeout>[] = [];
    const settle = () => {
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
      safeProbe.remove();
      root.style.removeProperty("--safe-bottom");
      root.style.setProperty("--keyboard-inset", "0px");
      root.style.setProperty("--viewport-pan", "0px");
      root.style.setProperty("--viewport-shrink", "0px");
    };
  }, []);
}
