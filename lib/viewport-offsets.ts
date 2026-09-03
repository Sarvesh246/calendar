/**
 * Pure geometry behind the fixed-chrome corrections published by
 * `useKeyboardInset()`. Kept free of the DOM so every case can be exercised
 * against faked viewport metrics (see `viewport-offsets.test.ts`) — the real
 * ones only occur on a device.
 */

export type ViewportMetrics = {
  /** `document.documentElement.clientHeight` — the layout viewport that
   *  `position: fixed` is resolved against. */
  layoutHeight: number;
  /** `visualViewport.height` — the part of it actually on screen. */
  visibleHeight: number;
  /** `visualViewport.offsetTop` — how far the visible area has been scrolled
   *  down inside the layout viewport. */
  offsetTop: number;
  /** `visualViewport.scale`. */
  scale: number;
  /** A text-entry field has focus. */
  typing: boolean;
  /** Layout height captured on `focusin`, or null when no keyboard session is
   *  open. */
  keyboardBase: number | null;
};

export type ViewportOffsets = {
  /** Push bottom chrome back down by this much to undo iOS panning the visual
   *  viewport up inside an unchanged layout viewport. */
  pan: number;
  /** ...and by this much to undo a browser shrinking the layout viewport for
   *  the keyboard outright. */
  shrink: number;
  /** Height currently hidden below the visible area — keyboard plus pan. */
  keyboardInset: number;
  /** `keyboardBase` carried forward, released once the keyboard has gone. */
  keyboardBase: number | null;
};

export function resolveViewportOffsets(m: ViewportMetrics): ViewportOffsets {
  // At scale != 1 a CSS-pixel correction wouldn't land on the window edge
  // anyway, and the offset there is a pan the user chose.
  const pinchZoomed = m.scale > 1.01;

  // Nothing is covering the window unless the visible area is shorter than the
  // layout viewport — and a visual viewport that fills its layout viewport
  // cannot be offset within it. Gating on that geometry, rather than on a
  // remembered value or on which element has focus, is what guarantees the
  // chrome sits where the layout puts it whenever no keyboard is up: a stale,
  // mistimed or plain wrong reading can shift it *while* the keyboard is up,
  // but can never leave it displaced at rest.
  const covered = m.visibleHeight < m.layoutHeight - 1;

  const pan = covered && !pinchZoomed ? Math.max(0, Math.round(m.offsetTop)) : 0;

  // Released on geometry rather than on blur — the keyboard is still on screen
  // for a few hundred ms after focus leaves, and dropping the correction early
  // would make the chrome jump ahead of it.
  let keyboardBase = m.keyboardBase;
  if (keyboardBase !== null && !m.typing && m.layoutHeight >= keyboardBase) keyboardBase = null;
  const shrink =
    keyboardBase === null
      ? 0
      : Math.min(Math.max(0, keyboardBase - m.layoutHeight), m.layoutHeight);

  let keyboardInset = 0;
  if (m.typing) {
    const hidden = m.layoutHeight - m.visibleHeight - m.offsetTop;
    keyboardInset = hidden > 1 ? Math.round(hidden) : 0;
  }

  return { pan, shrink, keyboardInset, keyboardBase };
}
