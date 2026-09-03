/**
 * Pure geometry behind the fixed-chrome corrections published by
 * `useKeyboardInset()`. Kept free of the DOM so every case can be exercised
 * against faked viewport metrics (see `viewport-offsets.test.ts`).
 */

/** Ceiling on `env(safe-area-inset-bottom)`. The iOS home indicator is 34px;
 *  Android gesture / 3-button nav is typically 24–48px. Anything above this is
 *  a launch-time lie, not a real inset. */
export const MAX_SAFE_BOTTOM = 48;

/** How long after launch or resume we keep forcing the layout pass that
 *  navigating to Agenda does for free. Past this the viewport is either
 *  honest or not going to become honest on its own. */
export const LAUNCH_WINDOW_MS = 10_000;

/** A probe gap this large is a keyboard / picker, not stale `position: fixed`. */
const MAX_CHROME_GAP = 80;

export type ViewportMetrics = {
  /** `document.documentElement.clientHeight` — the layout viewport that
   *  `position: fixed` is resolved against. */
  layoutHeight: number;
  /** `document.documentElement.clientWidth`. */
  layoutWidth: number;
  /** `window.innerHeight`. */
  innerHeight: number;
  /** Distance from a `position: fixed; bottom: 0` probe to the visual bottom,
   *  in CSS pixels. Positive = the probe (and the tab bar) sit too high.
   *  Never fed into a translate — that is what clipped the bar off screen. */
  chromeGap: number;
  /** `visualViewport.height`. */
  visibleHeight: number;
  /** `visualViewport.offsetTop`. */
  offsetTop: number;
  /** `visualViewport.scale`. */
  scale: number;
  /** Screen extent in CSS pixels, already matched to the current orientation.
   *  0 when it can't be read. Not used to move chrome: it runs larger than
   *  the app window on real iPhones (Dynamic Island, Display Zoom). */
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
  /** Milliseconds since the app launched or was resumed from the background. */
  sinceLaunch: number;
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
  /** Padding the tab bar should use. The env() inset, minus any overlap that
   *  is already baked into a *visibly* short layout viewport. */
  safeBottom: number;
  /** Force a layout pass so `position: fixed` re-resolves against the real
   *  window — the half of "navigate to Agenda" that actually fixed the
   *  launch bug. Never a translate. */
  needsRelayout: boolean;
};

/**
 * How much of `env(safe-area-inset-bottom)` is already baked into the layout
 * viewport. Only the visual viewport being *taller* than the layout viewport
 * is a trustworthy signal of that: nothing legitimate produces it.
 *
 * `screen.height - layoutHeight` is not. On real iPhones that difference is
 * often a home-indicator-sized lie (Dynamic Island, Display Zoom) while the
 * layout viewport already covers the window. Subtracting it sat the pill on
 * the physical bottom edge — too low on every screen, including Agenda.
 */
export function resolveSafeBottom(m: ViewportMetrics): number {
  const envSafe = Math.max(0, Math.min(Math.round(m.safeInset), MAX_SAFE_BOTTOM));
  if (!m.phoneChrome) return envSafe;
  if (m.typing) return envSafe;

  const visualGap = Math.round(m.visibleHeight) - m.layoutHeight;
  if (visualGap > 2) return Math.max(0, envSafe - visualGap);
  return envSafe;
}

function resolveNeedsRelayout(
  m: ViewportMetrics,
  state: { covered: boolean; pinchZoomed: boolean; keyboardBase: number | null }
): boolean {
  if (!m.phoneChrome || m.typing || state.keyboardBase !== null || state.pinchZoomed) {
    return false;
  }

  const visualGap = Math.round(m.visibleHeight) - m.layoutHeight;
  if (visualGap > 2) return true;

  // Layout and visual agree, but `position: fixed` is still sitting above the
  // visual bottom — the probe reads the same stale resolution the tab bar
  // does. A layout pass is what Agenda's route change did.
  if (!state.covered && m.chromeGap > 2 && m.chromeGap <= MAX_CHROME_GAP) return true;

  // Both viewports still short, probe gap zero: the only remaining move is
  // the 1px scroll-and-back that makes iOS re-resolve against the large
  // viewport. Armed only during the launch/resume window so an honest
  // viewport is not nudged forever.
  if (m.sinceLaunch <= LAUNCH_WINDOW_MS) return true;

  return false;
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
    needsRelayout: resolveNeedsRelayout(m, { covered, pinchZoomed, keyboardBase }),
  };
}
