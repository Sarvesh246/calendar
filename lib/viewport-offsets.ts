/**
 * Pure geometry behind the fixed-chrome corrections published by
 * `useKeyboardInset()`. Kept free of the DOM so every case can be exercised
 * against faked viewport metrics (see `viewport-offsets.test.ts`).
 *
 * The problem this solves, precisely: in an installed iOS PWA launched with
 * `viewport-fit=cover`, WebKit does not publish the real window to the layout
 * engine until the viewport has been "exercised" by a geometry change. Until
 * then `document.documentElement.clientHeight` (and `100dvh`, and
 * `-webkit-fill-available`) read short by a safe area — 59px, the top inset,
 * on the iPhone this was measured on — while `100vh` and `window.innerHeight`
 * already describe the real window. `position: fixed;
 * bottom: 0` resolves against the short one, so the tab bar hangs an inch
 * above the screen edge. Scrolling a long page (Agenda) is a geometry change,
 * which is why that one tab always looked right and "reset" the bar.
 *
 * So instead of guessing, we measure: a `position: fixed; top: 0; height:
 * 100vh` probe says where the window bottom is, a `position: fixed; bottom: 0`
 * probe says where fixed chrome actually landed, and the difference is fed
 * back as `--fixed-drop`. The probe carries that same variable, so every pass
 * reads what is *left over* after the correction already applied — the loop
 * converges to zero and unwinds itself the moment WebKit publishes the real
 * window.
 *
 * `--fixed-drop` alone is not enough, though, and the screenshots showed why:
 * WebKit paints fixed chrome into a layer the size of the layout viewport and
 * clips it there, so translating the tab bar past that edge shaved its bottom
 * off. Two things follow.
 *
 * `--window-height` is the real answer. Agenda was never healed by scrolling —
 * it was healed by *being long*: a document taller than the layout viewport is
 * the geometry change that makes WebKit publish the real window. Publishing the
 * measured window height as a `min-height` gives every screen that same
 * property, and costs nothing once the viewport is honest, because then it
 * equals the viewport exactly. (The community writes this as
 * `min-height: calc(100% + env(safe-area-inset-top))`; measuring is the same
 * number while stale and, unlike that form, stops overflowing once healed.)
 *
 * `--fixed-drop` is then the fallback for the frames before that lands, and is
 * capped at the chrome's own bottom padding so it can only ever push padding
 * past the clip, never a pixel anybody can see.
 */

/** Ceiling on `env(safe-area-inset-bottom)`. The iOS home indicator is 34px;
 *  Android gesture / 3-button nav is typically 24–48px. Anything above this is
 *  a launch-time lie, not a real inset. */
export const MAX_SAFE_BOTTOM = 48;

/** How long after launch or resume we keep forcing the layout pass that
 *  navigating to Agenda does for free. Past this the viewport is either
 *  honest or not going to become honest on its own. */
export const LAUNCH_WINDOW_MS = 10_000;

/** Hard ceiling on `--fixed-drop`. The whole shortfall is at most a phone's
 *  top plus bottom safe area (62 + 34 on the tallest iPhone); anything beyond
 *  this is a misreading, and honouring it would push the tab bar off the
 *  bottom of the screen — the failure mode this correction must never have. */
export const MAX_FIXED_DROP = 120;

/** Floor on the published `--window-height`. Below this a reading is a
 *  keyboard or a measurement accident, not a phone window, and using it as a
 *  `min-height` would collapse the page. */
export const MIN_WINDOW_HEIGHT = 320;

/** Residuals under this are rendering rounding, not a displaced viewport.
 *  Without it a ±1px flip-flop would jitter the bar every frame. */
export const FIXED_DROP_DEADBAND = 2;

export type ViewportMetrics = {
  /** `document.documentElement.clientHeight` — the layout viewport that
   *  `position: fixed` is resolved against, and the one iOS under-reports
   *  after a cold launch. */
  layoutHeight: number;
  /** `visualViewport.height`. */
  visibleHeight: number;
  /** `visualViewport.offsetTop`. */
  offsetTop: number;
  /** `visualViewport.scale`. */
  scale: number;
  /** Distance from where a `position: fixed; bottom: 0` probe *currently*
   *  lands (with `--fixed-drop` already applied to it) down to the real
   *  window bottom, in CSS pixels. Positive = bottom chrome is still too
   *  high. Zero once the correction has converged. */
  fixedGap: number;
  /** The `--fixed-drop` in force when `fixedGap` was measured. */
  fixedDrop: number;
  /** How far bottom chrome can be pushed past the layout viewport's bottom
   *  edge before a visible pixel crosses it — the tab bar's own bottom
   *  padding (`--safe-bottom` plus `--tab-bar-rest`). WebKit clips the fixed
   *  layer at that edge, so this is the whole budget the drop has. */
  dropHeadroom: number;
  /** Real window height in CSS pixels, from the same reading `fixedGap` is
   *  measured against. Published so the page box can overflow a stale layout
   *  viewport the way a long page does. */
  windowHeight: number;
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
  /** Padding the tab bar should use: the `env()` inset, full stop. */
  safeBottom: number;
  /** Standing correction that lands `position: fixed; bottom: 0` on the real
   *  window edge while the layout viewport is still short. Converges to 0. */
  fixedDrop: number;
  /** `min-height` for the page box, so a stale layout viewport is overflowed
   *  and WebKit publishes the real window. 0 when there is nothing to say. */
  windowHeight: number;
  /** Force a layout pass so `position: fixed` re-resolves against the real
   *  window — the half of "navigate to Agenda" that actually fixed the
   *  launch bug. Never a translate. */
  needsRelayout: boolean;
};

function clampDrop(px: number, headroom: number): number {
  // The drop may spend the chrome's own bottom padding and not a pixel more:
  // WebKit clips the fixed layer at the layout viewport's bottom edge, so
  // anything past that budget is simply not painted.
  const ceiling = Math.min(MAX_FIXED_DROP, Math.max(0, Math.round(headroom)));
  return Math.max(0, Math.min(Math.round(px), ceiling));
}

/**
 * The tab bar's own padding above the window edge.
 *
 * This is now simply `env(safe-area-inset-bottom)`. It used to subtract
 * `visualViewport.height - clientHeight`, on the theory that a visual viewport
 * taller than the layout viewport meant the home indicator was already baked
 * into the layout. It isn't: on iOS that difference *is* the cold-launch
 * under-report, and subtracting it zeroed the padding on every screen — which
 * is why the pill sat down on the home indicator once the bar did reach the
 * window edge. The shortfall is `--fixed-drop`'s job; the safe area is this
 * one's, and the two no longer fight over the same pixels.
 *
 * A browser that insets the viewport itself (no `viewport-fit=cover`) reports
 * `env()` as 0, so there is nothing here to double-count.
 */
export function resolveSafeBottom(m: ViewportMetrics): number {
  return Math.max(0, Math.min(Math.round(m.safeInset), MAX_SAFE_BOTTOM));
}

/**
 * Next value for `--fixed-drop`, given what the probe has left over.
 *
 * Integrating the residual rather than assigning it is what makes this safe:
 * the probe carries the correction, so an overshoot reads back negative and is
 * given back on the next pass, and WebKit finally publishing the real window
 * unwinds the drop to 0 by itself.
 */
export function resolveFixedDrop(m: ViewportMetrics): number {
  const current = clampDrop(m.fixedDrop, m.dropHeadroom);

  // Installed phone app only. In a browser tab `100vh` deliberately runs past
  // the visible area — that space is the address bar — so closing the gap
  // would hide the tab bar behind Safari's toolbar.
  if (!m.phoneChrome || !m.standalone) return 0;

  // Keyboard and pinch-zoom sessions move the visual viewport, not the window.
  // Freeze rather than chase; the resting value is still the right one.
  if (m.typing || m.keyboardBase !== null || m.scale > 1.01) return current;

  const residual = Math.round(m.fixedGap);
  if (Math.abs(residual) < FIXED_DROP_DEADBAND) return current;

  // A viewport the browser inset for us reports no bottom inset, and its gap
  // is that inset. Closing it would plant the pill on the home indicator —
  // the one thing this correction must never do.
  if (m.safeInset === 0 && residual > 0 && residual <= MAX_SAFE_BOTTOM) return current;

  return clampDrop(current + residual, m.dropHeadroom);
}

/**
 * The `min-height` to hang on the page box.
 *
 * This is the half of the fix that actually retires the problem. Agenda looked
 * right from the first frame not because anyone scrolled it but because it is
 * long: a document taller than the layout viewport is the geometry change that
 * makes WebKit publish the real window. Handing every screen the measured
 * window height as a floor reproduces that, and self-cancels — once the
 * viewport is honest the floor equals the viewport and nothing overflows.
 *
 * Installed phone app only, and never mid-keyboard: a shrunken viewport is not
 * a smaller window, and pinning the page to it would fight the browser.
 */
export function resolveWindowHeight(m: ViewportMetrics): number {
  if (!m.phoneChrome || !m.standalone) return 0;
  if (m.typing || m.keyboardBase !== null || m.scale > 1.01) return 0;
  const height = Math.round(m.windowHeight);
  return height >= MIN_WINDOW_HEIGHT ? height : 0;
}

function resolveNeedsRelayout(
  m: ViewportMetrics,
  state: { pinchZoomed: boolean; keyboardBase: number | null }
): boolean {
  if (!m.phoneChrome || m.typing || state.keyboardBase !== null || state.pinchZoomed) {
    return false;
  }

  // The layout viewport is visibly shorter than what is on screen.
  if (Math.round(m.visibleHeight) - m.layoutHeight > 2) return true;

  // `position: fixed` is not landing on the window edge. `--fixed-drop` is
  // already covering for that visually; a real layout pass would make the
  // correction unnecessary, which is better.
  if (Math.abs(Math.round(m.fixedGap)) >= FIXED_DROP_DEADBAND) return true;

  // Nothing measurable is wrong yet, but iOS often only publishes the real
  // window after the first geometry change. Keep asking during the launch
  // window; the hook stops after a handful of passes either way.
  return m.sinceLaunch <= LAUNCH_WINDOW_MS;
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
    fixedDrop: resolveFixedDrop({ ...m, keyboardBase }),
    windowHeight: resolveWindowHeight({ ...m, keyboardBase }),
    needsRelayout: resolveNeedsRelayout(m, { pinchZoomed, keyboardBase }),
  };
}
