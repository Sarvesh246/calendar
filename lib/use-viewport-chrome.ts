"use client";

import { useEffect } from "react";

function isStandalone() {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    Boolean(nav.standalone)
  );
}

/**
 * iOS standalone PWAs sometimes boot with a too-short layout viewport or a
 * bloated safe-area inset, which parks `position: fixed` chrome (the tab bar)
 * too high until the webview is recreated. This hook:
 *  - expands the document when the visual viewport is taller than the layout
 *  - publishes `--vv-bottom` (visual-viewport gap below the layout) and a
 *    clamped `--safe-bottom` for the home indicator
 *  - remeasures on launch, resume, and viewport changes
 */
export function useViewportChrome() {
  useEffect(() => {
    const root = document.documentElement;
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText =
      "position:fixed;left:0;bottom:0;width:0;height:0;padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none;box-sizing:content-box;";
    document.body.appendChild(probe);

    let raf = 0;
    const apply = () => {
      raf = 0;
      const vv = window.visualViewport;
      const innerH = window.innerHeight;
      const envBottom = probe.getBoundingClientRect().height;
      const vvHeight = vv?.height ?? innerH;
      const vvOffset = vv?.offsetTop ?? 0;
      const vvBottom = Math.max(0, innerH - vvHeight - vvOffset);

      const cap = isStandalone() ? 48 : 64;
      const safeBottom = Math.max(0, Math.min(envBottom, cap));

      root.style.setProperty("--safe-bottom", `${Math.round(safeBottom)}px`);
      root.style.setProperty("--vv-bottom", `${Math.round(vvBottom)}px`);

      if (vvHeight > innerH + 1) {
        root.style.minHeight = `${Math.round(vvHeight)}px`;
        root.classList.add("vv-fill");
      } else {
        root.style.minHeight = "";
        root.classList.remove("vv-fill");
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };

    apply();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.addEventListener("pageshow", schedule);
    document.addEventListener("visibilitychange", schedule);

    const timers = [50, 200, 600, 1200].map((ms) => window.setTimeout(schedule, ms));

    return () => {
      if (raf) cancelAnimationFrame(raf);
      timers.forEach((id) => window.clearTimeout(id));
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.removeEventListener("pageshow", schedule);
      document.removeEventListener("visibilitychange", schedule);
      root.style.minHeight = "";
      root.classList.remove("vv-fill");
      probe.remove();
    };
  }, []);
}
