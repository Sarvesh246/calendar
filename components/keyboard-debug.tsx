"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

const subscribeNone = () => () => {};
const readFlag = () => new URLSearchParams(window.location.search).has("kbdebug");

/**
 * `?kbdebug=1` — a read-out of everything the keyboard geometry depends on, so
 * the owner can open the assistant in the installed app, Safari and the PWA,
 * focus the field and screenshot what each one reports. Off unless the query
 * parameter is present; costs nothing otherwise.
 */
export function KeyboardDebugOverlay() {
  const on = useSyncExternalStore(subscribeNone, readFlag, () => false);
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!on) return;
    const vv = window.visualViewport;
    const root = document.documentElement;
    const vk = (
      navigator as Navigator & {
        virtualKeyboard?: EventTarget & { overlaysContent: boolean; boundingRect: DOMRect };
      }
    ).virtualKeyboard;
    const css = (name: string) => getComputedStyle(root).getPropertyValue(name).trim() || "—";
    const draw = () => {
      const el = ref.current;
      if (!el) return;
      const ua = navigator.userAgent.includes("DatebookNativeApp") ? "IPA shell" : "browser/PWA";
      el.textContent = [
        `ua: ${ua}`,
        `visualViewport.height: ${vv ? Math.round(vv.height) : "n/a"}`,
        `visualViewport.offsetTop: ${vv ? Math.round(vv.offsetTop) : "n/a"}`,
        `window.innerHeight: ${window.innerHeight}`,
        `documentElement.clientHeight: ${root.clientHeight}`,
        `--keyboard-inset: ${css("--keyboard-inset")}`,
        `--visible-height: ${css("--visible-height")}`,
        `--viewport-pan: ${css("--viewport-pan")}`,
        `virtualKeyboard: ${
          vk ? `yes, overlays=${vk.overlaysContent}, h=${Math.round(vk.boundingRect.height)}` : "no"
        }`,
        `focus: ${document.activeElement?.tagName ?? "none"}`,
      ].join("\n");
    };
    draw();
    const events: Array<[EventTarget | undefined, string]> = [
      [vv ?? undefined, "resize"],
      [vv ?? undefined, "scroll"],
      [window, "resize"],
      [window, "focusin"],
      [window, "focusout"],
      [vk, "geometrychange"],
    ];
    for (const [target, name] of events) target?.addEventListener(name, draw);
    // Custom properties are written from a rAF, after the events above.
    const timer = window.setInterval(draw, 250);
    return () => {
      for (const [target, name] of events) target?.removeEventListener(name, draw);
      window.clearInterval(timer);
    };
  }, [on]);

  if (!on) return null;
  return (
    <pre
      ref={ref}
      aria-hidden
      // Above every sheet, never takes a tap, pinned to the top so the keyboard
      // cannot cover it.
      className="pointer-events-none fixed left-2 top-[max(env(safe-area-inset-top),0.5rem)] z-[1000] whitespace-pre rounded-md bg-black/80 px-2 py-1.5 font-mono text-[10px] leading-[1.35] text-white"
    />
  );
}
