/**
 * Pure geometry behind the fixed-chrome corrections published by
 * `useKeyboardInset()`. Kept free of the DOM so every case can be exercised
 * against faked viewport metrics (see `viewport-offsets.test.ts`).
 */

/** iOS home indicator. Inflated `env(safe-area-inset-bottom)` values get
 *  clamped here so a launch-time lie cannot park the tab bar 60px high. */
export const MAX_SAFE_BOTTOM = 34;

/** A layout-vs-screen gap in this band is the home indicator counted twice
 *  (21px landscape, 34px portrait). Wider gaps are a lying `screen.height`
 *  and must not strip padding — that would drop the pill onto the indicator. */
const HOME_INDICATOR_MIN = 18;
const HOME_INDICATOR_MAX = 40;

export type ViewportMetrics = {
  /** `document.documentElement.clientHeight` — the layout viewport that
   *  `position: fixed` is resolved against. */
  layoutHeight: number;
  /** `document.documentElement.clientWidth`. */
  layoutWidth: number;
  /** `window.innerHeight`. */
  innerHeight: number;
  /** `visualViewport.height`. */
  visibleHeight: number;
  /** `visualViewport.offsetTop`. */
  offsetTop: number;
  /** `visualViewport.scale`. */
  scale: number;
  /** Screen extent in CSS pixels, already matched to the current orientation.
   *  0 when it can't be read. */
  screenHeight: number;
  screenWidth: number;
  /** Measured `env(safe-area-inset-bottom)` in CSS pixels, already capped. */
  safeInset: number;
  /** Running as an installed app rather than in browser chrome. */
  standalone: boolean;
  /** Narrow enough that the mobile tab bar is on screen. */
  phoneChrome: boolean;
  /** A text-entry field has focus. */
  typing: boolean;
  /** Layout height captured on `focusin`, or null when no keyboard session is
   *  open. */
  keyboardBase: number | null;
};

export type ViewportOffsets = {
  /** Push bottom chrome back down to undo iOS panning the visual viewport. */
  pan: number;
  /** …and to undo a browser shrinking the layout viewport for the keyboard. */
  shrink: number;
  /** Height currently hidden below the visible area — keyboard plus pan. */
  keyboardInset: number;
  /** `keyboardBase` carried forward, released once the keyboard has gone. */
  keyboardBase: number | null;
  /** Padding the tab bar should use. 0 when the layout viewport already
   *  excludes the home indicator, so `env()` would lift the pill twice. */
  safeBottom: number;
};

/**
 * How much of `env(safe-area-inset-bottom)` is already baked into the layout
 * viewport. Subtracting that from the padding — never translating the bar —
 * is what keeps the pill on the home-indicator edge without ever pushing it
 * off the bottom of the screen.
 */
export function resolveSafeBottom(m: ViewportMetrics): number {
  const envSafe = Math.max(0, Math.min(Math.round(m.safeInset), MAX_SAFE_BOTTOM));
  if (!m.phoneChrome) return envSafe;
  if (m.typing) return envSafe;

  // Visible area taller than the layout viewport: the layout is the short
  // one, and padding by the full inset would double-count that gap.
  const visualGap = Math.round(m.visibleHeight) - m.layoutHeight;
  let alreadyInset = visualGap > 2 ? visualGap : 0;

  // The common launch case: visual and layout agree, both already exclude
  // the home indicator, and `env()` still reports 34px. `screen.height` is
  // the only outside reading that can see the missing strip. Trusted only
  // for a home-indicator-sized gap on a full-width standalone window.
  if (
    alreadyInset === 0 &&
    m.standalone &&
    m.screenHeight > 0 &&
    Math.abs(m.screenWidth - m.layoutWidth) <= 2
  ) {
    const screenGap = m.screenHeight - m.layoutHeight;
    if (screenGap >= HOME_INDICATOR_MIN && screenGap <= HOME_INDICATOR_MAX) {
      alreadyInset = screenGap;
    }
  }

  return Math.max(0, envSafe - alreadyInset);
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

  let keyboardInset = 0;
  if (m.typing) {
    const hidden = m.layoutHeight - m.visibleHeight - m.offsetTop;
    keyboardInset = hidden > 1 ? Math.round(hidden) : 0;
  }

  return {
    pan,
    shrink,
    keyboardInset,
    keyboardBase,
    safeBottom: resolveSafeBottom(m),
  };
}
