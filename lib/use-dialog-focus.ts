"use client";

import { useEffect, type RefObject } from "react";

const focusable =
  'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keep keyboard navigation inside a modal and return to its opener on close. */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, open: boolean) {
  useEffect(() => {
    const panel = ref.current;
    if (!open || !panel) return;
    const previous = document.activeElement as HTMLElement | null;
    const candidates = () =>
      [...panel.querySelectorAll<HTMLElement>(focusable)].filter(
        (el) => el.getClientRects().length > 0 && !el.closest("[inert], [hidden]"),
      );
    const frame = requestAnimationFrame(() => {
      if (panel.contains(document.activeElement)) return;
      const asked = panel.querySelector<HTMLElement>("[data-autofocus]");
      // On touch, land on the dialog itself. The first control is usually a
      // close button or a picker, and focusing it there draws a focus ring
      // nobody asked for (or, for a field, raises the keyboard). Screen
      // readers still start inside the dialog.
      const touch = window.matchMedia("(pointer: coarse)").matches;
      if (touch && !panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");
      const target = asked ?? (touch ? panel : (candidates()[0] ?? panel));
      target.focus({ preventScroll: true });
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      // A nested dialog owns its own keyboard interaction.
      const activeDialog = (document.activeElement as HTMLElement | null)?.closest(
        '[role="dialog"]',
      );
      if (activeDialog && activeDialog !== panel) return;
      const elements = candidates();
      const first = elements[0] ?? panel;
      const last = elements.at(-1) ?? panel;
      if (
        !panel.contains(document.activeElement) ||
        (event.shiftKey && document.activeElement === first) ||
        (!event.shiftKey && document.activeElement === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      if (
        previous?.isConnected &&
        (panel.contains(document.activeElement) || document.activeElement === document.body)
      ) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [ref, open]);
}
