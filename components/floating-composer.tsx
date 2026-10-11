"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { QuickAddBar } from "./quick-add-bar";
import { useUIStore } from "@/lib/ui-store";
import { useMediaQuery } from "@/lib/use-media-query";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";
import { prefersReducedMotion, springEasing, supportsLinearEasing } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Out of the +: a quick swing with a little overshoot, then it locks in place. */
const OPEN = springEasing(0.42, 0.8);
/** Back into the +: no overshoot, and quicker than the arrival. */
const CLOSE = springEasing(0.3, 1);
const OPEN_FALLBACK = { easing: "cubic-bezier(0.2, 0.9, 0.25, 1.06)", duration: 420 };
const CLOSE_FALLBACK = { easing: "cubic-bezier(0.3, 0, 0.2, 1)", duration: 260 };
const FADE_IN = { duration: 140, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" };
const FADE_OUT = { duration: 150, easing: "cubic-bezier(0.4, 0, 0.6, 1)" };
const SCRIM_IN = { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" };
const SCRIM_OUT = { duration: 170, easing: "cubic-bezier(0.4, 0, 0.2, 1)" };
/** How small the panel is when it is still "inside" the + button. */
const SEED_SCALE = 0.18;

/**
 * Where the panel would have to sit, and how small it would be, to be the +
 * button. Measured off the live button so it holds at any text size.
 */
function seedTransform(panel: HTMLElement) {
  const button = document.querySelector<HTMLElement>(".mobile-add-button");
  // Layout box, not the client rect: the panel may be mid-flight, and its
  // own transform must not move the target it is aiming for.
  const p = { left: panel.offsetLeft, top: panel.offsetTop, width: panel.offsetWidth, height: panel.offsetHeight };
  if (!button || p.width === 0) return `translate(0px, 24px) scale(0.92)`;
  const b = button.getBoundingClientRect();
  const dx = b.left + b.width / 2 - (p.left + p.width / 2);
  const dy = b.top + b.height / 2 - (p.top + p.height / 2);
  return `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${SEED_SCALE})`;
}

/** Stop whatever is running on `el`, leaving it where it visibly is. */
function freeze(el: HTMLElement) {
  const running = el.getAnimations();
  if (!running.length) return;
  const style = getComputedStyle(el);
  const transform = style.transform;
  const opacity = style.opacity;
  running.forEach((a) => a.cancel());
  el.style.transform = transform === "none" ? "" : transform;
  el.style.opacity = opacity;
}

/**
 * The phone's floating composer and its veil.
 *
 * Kept out of `AppShell` on purpose: when the shell itself subscribed to
 * `quickAddOpen`, every tap on + re-rendered the whole app (rail, header,
 * page host) before the first frame of the panel could paint — the lag you
 * felt between the tap and anything happening.
 *
 * Both the panel and the scrim animate through the Web Animations API on
 * `transform` / `opacity`, which the compositor runs by itself. Mounting the
 * composer, focusing the field and raising the keyboard all happen on the main
 * thread in those same frames; a Framer spring would wait on that work and
 * stutter, a compositor animation doesn't.
 */
export function FloatingComposer() {
  const desktop = useMediaQuery("(min-width: 768px)");
  const quickAddOpen = useUIStore((s) => s.quickAddOpen);
  const closeQuickAdd = useUIStore((s) => s.closeQuickAdd);
  const open = quickAddOpen && !desktop;

  // Stays true through the exit so the panel can travel home before it unmounts.
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);

  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLButtonElement>(null);
  useDialogFocus(panelRef, open);
  useLockBodyScroll(present);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const scrim = scrimRef.current;
    if (!panel || !scrim) return;
    const reduced = prefersReducedMotion();
    const linear = supportsLinearEasing();

    if (open) {
      freeze(panel);
      freeze(scrim);
      const from = panel.style.transform || seedTransform(panel);
      const fromOpacity = panel.style.opacity || "0";
      panel.style.transform = "";
      panel.style.opacity = "";
      const spring = linear ? OPEN : OPEN_FALLBACK;
      if (!reduced) {
        panel.animate([{ transform: from }, { transform: "none" }], {
          duration: spring.duration,
          easing: spring.easing,
        });
      }
      panel.animate([{ opacity: fromOpacity }, { opacity: 1 }], FADE_IN);
      const scrimFrom = scrim.style.opacity || "0";
      scrim.style.opacity = "";
      scrim.animate([{ opacity: scrimFrom }, { opacity: 1 }], SCRIM_IN);
      return;
    }

    if (!present) return;
    freeze(panel);
    freeze(scrim);
    const from = panel.style.transform || "none";
    const spring = linear ? CLOSE : CLOSE_FALLBACK;
    const home = seedTransform(panel);
    const fade = panel.animate([{ opacity: panel.style.opacity || "1" }, { opacity: 0 }], {
      ...FADE_OUT,
      fill: "forwards",
    });
    if (!reduced) {
      panel.animate([{ transform: from }, { transform: home }], {
        duration: spring.duration,
        easing: spring.easing,
        fill: "forwards",
      });
    }
    scrim.animate([{ opacity: scrim.style.opacity || "1" }, { opacity: 0 }], { ...SCRIM_OUT, fill: "forwards" });
    let cancelled = false;
    // Gone as soon as it is invisible; the tail of the travel isn't worth waiting for.
    fade.finished.then(
      () => {
        if (!cancelled) setPresent(false);
      },
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, [open, present]);

  if (!present) return null;

  return (
    <>
      <button
        ref={scrimRef}
        type="button"
        aria-label="Dismiss add"
        tabIndex={-1}
        // Dismiss on press, not release: the veil lets go of the page the
        // instant you touch it, and stops taking taps while it fades.
        onPointerDown={open ? closeQuickAdd : undefined}
        className={cn(
          "overlay-scrim-light press-none viewport-pinned-top viewport-pinned-overlay fixed inset-0 z-[45]",
          !open && "pointer-events-none"
        )}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal
        aria-label="Add item"
        tabIndex={-1}
        style={{
          top: "calc(env(safe-area-inset-top) + 4.25rem)",
          willChange: "transform, opacity",
        }}
        className={cn(
          "mobile-composer viewport-pinned-top fixed inset-x-3 z-[46] mx-auto max-h-[calc(var(--visible-height,100dvh)-5rem)] max-w-[760px] overflow-y-auto overscroll-contain md:inset-x-6",
          !open && "pointer-events-none"
        )}
      >
        <QuickAddBar />
      </div>
    </>
  );
}
