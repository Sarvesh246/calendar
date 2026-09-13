"use client";

import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useUIStore, type ContextMenuRequest } from "./ui-store";

/** The element a menu opened from, so focus can go back to it on close. */
let opener: HTMLElement | null = null;

export function takeMenuOpener(): HTMLElement | null {
  const el = opener;
  opener = null;
  return el;
}

function desktop() {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
}

/** Open the item menu anchored under an element (a "More" button, a row). */
export function openItemMenuAt(
  el: HTMLElement,
  itemId: string,
  extra: Pick<ContextMenuRequest, "dayKey" | "section"> = {}
) {
  const r = el.getBoundingClientRect();
  opener = el;
  useUIStore.getState().openContextMenu({ itemId, x: r.left, y: r.bottom + 4, ...extra });
}

/**
 * Right-click and keyboard (Shift+F10 / the Menu key) open the same item menu
 * wherever an item is drawn. Phones keep their long-press sheets instead.
 */
export function itemMenuProps(itemId: string, dayKey?: string) {
  return {
    onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
      if (!desktop()) return;
      e.preventDefault();
      e.stopPropagation();
      opener = e.currentTarget;
      useUIStore.getState().openContextMenu({ itemId, x: e.clientX, y: e.clientY, dayKey });
    },
  };
}

/** Call from an item's onKeyDown. Returns true when it opened the menu. */
export function handleItemMenuKey(e: ReactKeyboardEvent<HTMLElement>, itemId: string, dayKey?: string) {
  if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return false;
  if (!desktop()) return false;
  e.preventDefault();
  e.stopPropagation();
  const r = e.currentTarget.getBoundingClientRect();
  opener = e.currentTarget;
  useUIStore.getState().openContextMenu({ itemId, x: r.left + 12, y: Math.min(r.bottom, r.top + 28), dayKey });
  return true;
}
