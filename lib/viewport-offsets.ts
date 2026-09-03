/**
 * Pure geometry behind the fixed-chrome corrections published by
 * `useKeyboardInset()`. Kept free of the DOM so every case can be exercised
 * against faked viewport metrics (see `viewport-offsets.test.ts`) — the real
 * ones only occur on a device, and the interesting ones only during the first
 * second of a cold PWA launch.
 */

/** Largest resting correction that can possibly be a mis-resolved viewport.
 *
 *  The gap it corrects is a safe-area inset counted twice, and no iOS device
 *  has insets anywhere near this: the home indicator is 34px, the tallest
 *  status bar 59px, both together 93px. An on-screen keyboard, by contrast, is
 *  250-350px. Refusing anything larger is what lets the resting correction stay
 *  armed permanently without ever mistaking a keyboard — or a date picker, or
 *  an autofill bar, none of which focus a text field — for a launch-time
 *  viewport bug. */
export const MAX_REST_CORRECTION = 120;

/** How long after a launch or a resume the screen-extent check stays armed.
 *
 *  It is the one check that trusts something outside the page (`window.screen`)
 *  over the browser's own layout viewport, and the state it detects belongs to
 *  the moments right after launch. Past this it stands down, so a device where
 *  the window legitimately doesn't span the screen can be wrong about it for a
 *  few seconds at worst rather than forever. */
export const LAUNCH_WINDOW_MS = 10_000;

export type ViewportMetrics = {
  /** `document.documentElement.clientHeight` — the layout viewport that
   *  `position: fixed` is resolved against. */
  layoutHeight: number;
  /** `document.documentElement.clientWidth`. */
  layoutWidth: number;
  /** `visualViewport.height` — the part of it actually on screen. */
  visibleHeight: number;
  /** `visualViewport.offsetTop` — how far the visible area has been scrolled
   *  down inside the layout viewport. */
  offsetTop: number;
  /** `visualViewport.scale`. */
  scale: number;
  /** Screen extent in CSS pixels, already matched to the current orientation.
   *  0 when it can't be read. */
  screenHeight: number;
  screenWidth: number;
  /** Running as an installed app rather than in browser chrome. */
  standalone: boolean;
  /** The viewport is narrow enough that the mobile chrome (bottom tab bar,
   *  FAB) is the chrome on screen. Every element the resting correction moves
   *  is `md:hidden`, so above that width there is nothing to correct — and a
   *  desktop PWA window, which legitimately doesn't fill the screen, is exactly
   *  where the screen-extent check would otherwise misfire. */
  phoneChrome: boolean;
  /** A text-entry field has focus. */
  typing: boolean;
  /** Layout height captured on `focusin`, or null when no keyboard session is
   *  open. */
  keyboardBase: number | null;
  /** Milliseconds since the app launched or was resumed from the background. */
  sinceLaunch: number;
};

export type ViewportOffsets = {
  /** Push bottom chrome back down by this much to undo iOS panning the visual
   *  viewport up inside an unchanged layout viewport. */
  pan: number;
  /** ...and by this much to undo a browser shrinking the layout viewport for
   *  the keyboard outright. */
  shrink: number;
  /** ...and by this much when the layout viewport the browser resolved
   *  `bottom: 0` against is shorter than the window actually on screen. 0
   *  whenever the geometry is honest, which is every case but a launch still
   *  settling. */
  underflow: number;
  /** Height currently hidden below the visible area — keyboard plus pan. */
  keyboardInset: number;
  /** `keyboardBase` carried forward, released once the keyboard has gone. */
  keyboardBase: number | null;
  /** The layout viewport disagrees with the window: worth forcing a layout pass
   *  so the browser gets a chance to resolve the chrome against the real one. */
  needsRelayout: boolean;
};

/**
 * How far the layout viewport falls short of the window that is actually on
 * screen — the amount bottom-anchored chrome has to be pushed down to sit on
 * the real window edge.
 *
 * Two independent readings, whichever is larger (never their sum — they are two
 * views of the same gap):
 *
 *  1. The visible area is *taller* than the layout viewport. Nothing legitimate
 *     produces that; it means the layout viewport is stale and short.
 *  2. In an installed app the window is the whole screen, so the layout
 *     viewport has to be the screen's height. Less means `viewport-fit: cover`
 *     has not been applied yet — the launch-time state where the layout
 *     viewport already excludes the home indicator, so the chrome's own
 *     safe-area padding lifts it clear of the window a second time. This is the
 *     one that leaves the tab bar parked an inset above where it belongs until
 *     something forces a fresh layout pass.
 */
function restingUnderflow(
  m: ViewportMetrics,
  state: { covered: boolean; pinchZoomed: boolean; keyboardBase: number | null }
): number {
  // Only at rest. Anything covering the window, a keyboard session still
  // unwinding, or a pan the user chose by pinching, is the other corrections'
  // business and this one must keep out of it.
  if (state.covered || state.pinchZoomed || m.typing || state.keyboardBase !== null) return 0;
  if (!m.phoneChrome) return 0;

  let gap = Math.round(m.visibleHeight) - m.layoutHeight;

  if (
    m.standalone &&
    m.sinceLaunch <= LAUNCH_WINDOW_MS &&
    m.screenHeight > 0 &&
    // Only when the window spans the screen's full width. When it doesn't —
    // iPad Split View, a resized desktop PWA — the screen says nothing about
    // how tall the window is meant to be.
    Math.abs(m.screenWidth - m.layoutWidth) <= 2
  ) {
    gap = Math.max(gap, m.screenHeight - m.layoutHeight);
  }

  // Sub-pixel rounding is not a bug to correct, and see MAX_REST_CORRECTION for
  // why anything large is something other than a mis-resolved viewport.
  if (gap <= 2 || gap > MAX_REST_CORRECTION) return 0;
  return gap;
}

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

  const underflow = restingUnderflow(m, { covered, pinchZoomed, keyboardBase });

  let keyboardInset = 0;
  if (m.typing) {
    const hidden = m.layoutHeight - m.visibleHeight - m.offsetTop;
    keyboardInset = hidden > 1 ? Math.round(hidden) : 0;
  }

  return { pan, shrink, underflow, keyboardInset, keyboardBase, needsRelayout: underflow > 0 };
}
