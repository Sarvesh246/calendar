"use client";

import { useEffect, type RefObject } from "react";

/**
 * Keep the field you are typing in — and the button that submits it — above
 * the keyboard.
 *
 * `useKeyboardInset` already welds the app's fixed chrome to the visible
 * viewport, and the sheets size themselves against `--visible-height`. What
 * neither does is scroll: focus a field near the bottom of a tall sheet and iOS
 * makes its own guess, which is reliably either "not far enough" (the field
 * sits under the keyboard's suggestion bar) or "much too far" (the field is
 * slammed against the status bar and the Add button is off the top).
 *
 * So we do it ourselves, once, after the keyboard geometry settles: find the
 * focused field, work out where it and its submit row actually are against
 * `visualViewport`, and scroll the field's own scroll container by the smallest
 * amount that puts both inside. Smallest is the point — a nudge you barely
 * notice reads as the app being well-behaved; a jump reads as a bug.
 */

/** Air left above the field and below the primary action, in CSS pixels. */
const MARGIN = 12;
/** Below this, a correction is noise — leave the browser's placement alone. */
const DEADZONE = 4;

function scrollParent(el: HTMLElement, within: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    const scrolls = /auto|scroll|overlay/.test(style.overflowY);
    if (scrolls && node.scrollHeight > node.clientHeight + 1) return node;
    if (node === within) return null;
    node = node.parentElement;
  }
  return null;
}

/**
 * The rect the field has to fit inside: the visual viewport, which is what the
 * keyboard actually shrinks. Falls back to the layout viewport on browsers
 * without one (every desktop, where this is a no-op anyway).
 */
function visibleBand(): { top: number; bottom: number } {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  if (!vv) return { top: 0, bottom: window.innerHeight };
  // visualViewport coordinates are relative to the layout viewport, which is
  // the same space `getBoundingClientRect` reports in once iOS has panned.
  return { top: 0, bottom: vv.height };
}

export function useKeepFieldVisible(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean
) {
  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;
    if (!window.matchMedia("(max-width: 767px)").matches) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const correct = () => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || !container.contains(active)) return;
      const tag = active.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA" && !active.isContentEditable) return;

      const band = visibleBand();
      const field = active.getBoundingClientRect();

      // The primary action travels with the field when it sits in the same
      // row — a send button beside the input, an Add under it. Keeping the
      // union visible is what makes "type, then confirm" one movement.
      const action = active
        .closest("[data-field-group]")
        ?.querySelector<HTMLElement>("[data-primary-action]");
      const actionRect = action?.getBoundingClientRect();
      const top = Math.min(field.top, actionRect?.top ?? field.top);
      const bottom = Math.max(field.bottom, actionRect?.bottom ?? field.bottom);

      let delta = 0;
      if (bottom + MARGIN > band.bottom) delta = bottom + MARGIN - band.bottom;
      if (top - MARGIN < band.top) {
        // Never trade a hidden bottom for a hidden top: if the pair is taller
        // than the band, pin the field's top and let the action go.
        delta = Math.min(delta, top - MARGIN - band.top);
      }
      if (Math.abs(delta) < DEADZONE) return;

      const scroller = scrollParent(active, container);
      if (scroller) {
        const max = scroller.scrollHeight - scroller.clientHeight;
        const next = Math.max(0, Math.min(max, scroller.scrollTop + delta));
        if (Math.abs(next - scroller.scrollTop) >= DEADZONE) scroller.scrollTop = next;
        return;
      }
      // No inner scroller — the sheet itself is the whole surface, so move the
      // document instead. `scrollBy` rather than `scrollIntoView`: the latter
      // re-centres, which is the over-correction we are here to avoid.
      window.scrollBy({ top: delta, behavior: "instant" as ScrollBehavior });
    };

    /** Let the keyboard finish opening before measuring against it. */
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(correct, 120);
    };

    container.addEventListener("focusin", schedule);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", schedule);

    return () => {
      if (timer) clearTimeout(timer);
      container.removeEventListener("focusin", schedule);
      vv?.removeEventListener("resize", schedule);
    };
  }, [containerRef, enabled]);
}
