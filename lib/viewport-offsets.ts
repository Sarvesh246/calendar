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
  /** `window.innerHeight` — often reflects the real window before the layout
   *  viewport catches up on a cold PWA launch. */
  innerHeight: number;
  /** Distance from a `position: fixed; bottom: 0` probe to the window bottom,
   *  measured in CSS pixels. Used to detect stale fixed resolution once the
   *  layout viewport has already corrected — never fed into the translate term,
   *  which would double-correct and clip the tab bar off screen. */
  chromeGap: number;
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
   *  FAB) is the chrome on screen. */
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
  /** ...and by this much while the *layout viewport itself* is still shorter
   *  than the window. Zero once the layout is honest — even if fixed chrome
   *  has not been relaid out yet — so a corrected viewport never gets a
   *  translate piled on top and clipped off screen. */
  underflow: number;
  /** Height currently hidden below the visible area — keyboard plus pan. */
  keyboardInset: number;
  /** `keyboardBase` carried forward, released once the keyboard has gone. */
  keyboardBase: number | null;
  /** Worth forcing a layout pass so `position: fixed` re-resolves against the
   *  real window — the half of "navigate to another tab" that actually fixed
   *  the launch bug, and the only safe move once the layout viewport is
   *  already whole but the probe still reads a gap. */
  needsRelayout: boolean;
};

/**
 * How far the layout viewport itself still falls short of the window on screen.
 * This is the only signal that may drive `--viewport-underflow` translate.
 */
function layoutShortfall(
  m: ViewportMetrics,
  state: { covered: boolean; pinchZoomed: boolean; keyboardBase: number | null }
): number {
  if (state.covered || state.pinchZoomed || m.typing || state.keyboardBase !== null) return 0;
  if (!m.phoneChrome) return 0;

  let gap = Math.round(m.visibleHeight) - m.layoutHeight;

  const innerGap = m.innerHeight > 0 ? m.innerHeight - m.layoutHeight : 0;
  if (innerGap > 0 && (gap > 0 || (m.standalone && m.sinceLaunch <= LAUNCH_WINDOW_MS))) {
    gap = Math.max(gap, innerGap);
  }

  if (
    m.standalone &&
    m.sinceLaunch <= LAUNCH_WINDOW_MS &&
    m.screenHeight > 0 &&
    Math.abs(m.screenWidth - m.layoutWidth) <= 2
  ) {
    gap = Math.max(gap, m.screenHeight - m.layoutHeight);
  }

  if (gap <= 2 || gap > MAX_REST_CORRECTION) return 0;
  return gap;
}

function isPlausibleChromeGap(gap: number): boolean {
  return gap > 2 && gap <= MAX_REST_CORRECTION;
}

export function resolveViewportOffsets(m: ViewportMetrics): ViewportOffsets {
  const pinchZoomed = m.scale > 1.01;

  const covered = m.visibleHeight < m.layoutHeight - 1;

  const pan = covered && !pinchZoomed ? Math.max(0, Math.round(m.offsetTop)) : 0;

  let keyboardBase = m.keyboardBase;
  if (keyboardBase !== null && !m.typing && m.layoutHeight >= keyboardBase) keyboardBase = null;
  const shrink =
    keyboardBase === null
      ? 0
      : Math.min(Math.max(0, keyboardBase - m.layoutHeight), m.layoutHeight);

  const underflow = layoutShortfall(m, { covered, pinchZoomed, keyboardBase });

  let keyboardInset = 0;
  if (m.typing) {
    const hidden = m.layoutHeight - m.visibleHeight - m.offsetTop;
    keyboardInset = hidden > 1 ? Math.round(hidden) : 0;
  }

  const atRest = !m.typing && keyboardBase === null && !covered;
  const staleFixed =
    atRest &&
    m.phoneChrome &&
    underflow === 0 &&
    isPlausibleChromeGap(m.chromeGap);

  const needsRelayout =
    staleFixed ||
    underflow > 0 ||
    (atRest &&
      m.phoneChrome &&
      m.standalone &&
      m.sinceLaunch <= LAUNCH_WINDOW_MS);

  return { pan, shrink, underflow, keyboardInset, keyboardBase, needsRelayout };
}
