import { describe, expect, it } from "vitest";
import {
  LAUNCH_WINDOW_MS,
  MAX_FIXED_DROP,
  MAX_SAFE_BOTTOM,
  MIN_WINDOW_HEIGHT,
  resolveFixedDrop,
  resolveSafeBottom,
  resolveViewportOffsets,
  resolveWindowHeight,
  type ViewportMetrics,
} from "./viewport-offsets";

/** An iPhone-shaped installed app, at rest, with an honest cover viewport.
 *  `sinceLaunch` defaults past the launch window so resting tests do not
 *  inherit the Agenda-style relayout that is only armed after a cold start. */
function metrics(over: Partial<ViewportMetrics> = {}): ViewportMetrics {
  const layoutHeight = over.layoutHeight ?? 852;
  return {
    layoutHeight,
    visibleHeight: layoutHeight,
    offsetTop: 0,
    scale: 1,
    fixedGap: 0,
    fixedDrop: 0,
    // 34px home indicator + 12px --tab-bar-rest, the tab bar's own padding.
    dropHeadroom: 46,
    windowHeight: 852,
    safeInset: 34,
    standalone: true,
    phoneChrome: true,
    typing: false,
    keyboardBase: null,
    sinceLaunch: LAUNCH_WINDOW_MS + 1,
    ...over,
  };
}

/** The state the bug reports came from, measured off the screenshots: an
 *  installed app cold-launched with `viewport-fit=cover`, where WebKit is
 *  still resolving `position: fixed` against a layout viewport short by the
 *  59px top inset, while `100vh` already describes the real 852px window.
 *  WebKit also clips the fixed layer at 793, which is why the drop cannot
 *  simply spend all 59. */
function coldLaunch(over: Partial<ViewportMetrics> = {}): ViewportMetrics {
  return metrics({
    layoutHeight: 793,
    visibleHeight: 793,
    fixedGap: 59,
    windowHeight: 852,
    sinceLaunch: 0,
    ...over,
  });
}

describe("at rest", () => {
  it("keeps the home-indicator padding and adds no correction on an honest viewport", () => {
    expect(resolveViewportOffsets(metrics())).toMatchObject({
      pan: 0,
      shrink: 0,
      keyboardInset: 0,
      safeBottom: 34,
      fixedDrop: 0,
      needsRelayout: false,
    });
  });

  it("ignores a stale offsetTop while the viewport fills its layout viewport", () => {
    expect(resolveViewportOffsets(metrics({ offsetTop: 300 })).pan).toBe(0);
  });
});

describe("safe-area padding", () => {
  it("keeps the full inset while the layout viewport is still short", () => {
    // The regression the screenshots showed: subtracting
    // `visibleHeight - layoutHeight` zeroed --safe-bottom on every screen, so
    // once the bar did reach the window edge it sat on the home indicator
    // with only --tab-bar-rest under it.
    expect(resolveSafeBottom(coldLaunch())).toBe(34);
  });

  it("does not strip padding when visual and layout agree but both fall short", () => {
    expect(resolveSafeBottom(metrics({ layoutHeight: 818, visibleHeight: 818 }))).toBe(34);
  });

  it("clamps an inflated env() inset to the ceiling", () => {
    expect(resolveSafeBottom(metrics({ safeInset: 120 }))).toBe(MAX_SAFE_BOTTOM);
  });

  it("keeps a 48px Android inset instead of clipping it to the iOS home indicator", () => {
    expect(resolveSafeBottom(metrics({ safeInset: 48 }))).toBe(48);
  });

  it("reports nothing to pad on a device with no bottom inset", () => {
    expect(resolveSafeBottom(metrics({ safeInset: 0 }))).toBe(0);
  });

  it("keeps full padding while typing so the bar does not jump when the keyboard opens", () => {
    expect(resolveSafeBottom(metrics({ typing: true, visibleHeight: 552, offsetTop: 300 }))).toBe(
      34
    );
  });

  it("pads phone and desktop chrome alike", () => {
    expect(resolveSafeBottom(metrics({ phoneChrome: false, layoutHeight: 818 }))).toBe(34);
  });
});

describe("fixed-position drop (the cold-launch bar)", () => {
  it("closes the measured gap as far as the clip lets it", () => {
    // 59px is missing, but WebKit clips the fixed layer at the layout
    // viewport, so only the bar's own 46px of bottom padding can be spent
    // without shaving the pill. --window-height covers the rest by making the
    // viewport honest.
    expect(resolveFixedDrop(coldLaunch())).toBe(46);
  });

  it("closes a shortfall that fits inside the padding outright", () => {
    expect(resolveFixedDrop(coldLaunch({ fixedGap: 34 }))).toBe(34);
  });

  it("lands the pill a safe area plus its rest above the window edge", () => {
    // 852 window, `bottom: 0` landing at 818, drop 34, then the bar's own
    // padding: 34 of home indicator and 12 of --tab-bar-rest above that.
    const out = resolveViewportOffsets(coldLaunch({ layoutHeight: 818, fixedGap: 34 }));
    expect(818 + out.fixedDrop - out.safeBottom).toBe(852 - 34);
  });

  it("never translates a visible pixel past the fixed layer's clip", () => {
    expect(resolveFixedDrop(coldLaunch({ fixedGap: 400 }))).toBe(46);
    expect(resolveFixedDrop(coldLaunch({ dropHeadroom: 0, fixedGap: 59 }))).toBe(0);
  });

  it("holds still once the correction has landed", () => {
    expect(resolveFixedDrop(coldLaunch({ fixedDrop: 46, fixedGap: 0 }))).toBe(46);
  });

  it("unwinds itself when WebKit finally publishes the real window", () => {
    // Same correction still applied, but `bottom: 0` now resolves 46px lower,
    // so the probe reads 46px past the edge and gives the whole thing back.
    expect(
      resolveFixedDrop(metrics({ fixedDrop: 46, fixedGap: -46, layoutHeight: 852 }))
    ).toBe(0);
  });

  it("gives back an overshoot instead of leaving chrome off screen", () => {
    expect(resolveFixedDrop(metrics({ fixedDrop: 40, fixedGap: -12 }))).toBe(28);
  });

  it("ignores sub-pixel rounding so the bar cannot jitter", () => {
    expect(resolveFixedDrop(metrics({ fixedDrop: 46, fixedGap: 1 }))).toBe(46);
    expect(resolveFixedDrop(metrics({ fixedDrop: 46, fixedGap: -1 }))).toBe(46);
  });

  it("refuses a reading too large to be a safe-area shortfall", () => {
    expect(resolveFixedDrop(metrics({ fixedGap: 400, dropHeadroom: 999 }))).toBe(MAX_FIXED_DROP);
  });

  it("never pushes chrome into a home indicator the browser already inset for", () => {
    // No env() inset reported means the viewport is inset for us; the gap is
    // the safe area itself, and closing it is the one move that must not
    // happen.
    expect(resolveFixedDrop(metrics({ safeInset: 0, fixedGap: 34 }))).toBe(0);
  });

  it("stays out of browser chrome, where 100vh runs under the address bar", () => {
    expect(resolveFixedDrop(coldLaunch({ standalone: false }))).toBe(0);
  });

  it("leaves desktop layouts alone", () => {
    expect(resolveFixedDrop(coldLaunch({ phoneChrome: false }))).toBe(0);
  });

  it("freezes at its resting value while the keyboard is up", () => {
    expect(
      resolveFixedDrop(
        coldLaunch({ fixedDrop: 46, typing: true, visibleHeight: 452, offsetTop: 300, fixedGap: 300 })
      )
    ).toBe(46);
  });

  it("freezes through the keyboard's closing animation", () => {
    expect(
      resolveFixedDrop(coldLaunch({ fixedDrop: 46, keyboardBase: 852, fixedGap: 300 }))
    ).toBe(46);
  });

  it("keeps out of a viewport the user moved by pinching", () => {
    expect(resolveFixedDrop(coldLaunch({ fixedDrop: 46, scale: 2, fixedGap: 200 }))).toBe(46);
  });

  it("resumes on the pass after the keyboard releases", () => {
    const out = resolveViewportOffsets(
      metrics({ typing: false, keyboardBase: 852, layoutHeight: 852, fixedGap: 34 })
    );
    expect(out.keyboardBase).toBeNull();
    expect(out.fixedDrop).toBe(34);
  });
});

describe("page-box floor (what Agenda was doing all along)", () => {
  it("publishes the real window so a short viewport is overflowed", () => {
    // 852 floor against a 793 layout viewport: 59px of overflow, which is the
    // geometry change that makes WebKit publish the real window.
    expect(resolveWindowHeight(coldLaunch())).toBe(852);
  });

  it("self-cancels once the viewport is honest", () => {
    // Still published, but now equal to the viewport — nothing overflows.
    const m = metrics({ layoutHeight: 852, windowHeight: 852 });
    expect(resolveWindowHeight(m)).toBe(m.layoutHeight);
  });

  it("stays out of browser chrome, where 100vh is the address bar's business", () => {
    expect(resolveWindowHeight(coldLaunch({ standalone: false }))).toBe(0);
  });

  it("leaves desktop layouts alone", () => {
    expect(resolveWindowHeight(coldLaunch({ phoneChrome: false }))).toBe(0);
  });

  it("says nothing while the keyboard is up, so the page is not pinned to it", () => {
    expect(resolveWindowHeight(coldLaunch({ typing: true, visibleHeight: 452 }))).toBe(0);
    expect(resolveWindowHeight(coldLaunch({ keyboardBase: 852 }))).toBe(0);
    expect(resolveWindowHeight(coldLaunch({ scale: 2 }))).toBe(0);
  });

  it("refuses a reading too small to be a phone window", () => {
    expect(resolveWindowHeight(coldLaunch({ windowHeight: MIN_WINDOW_HEIGHT - 1 }))).toBe(0);
    expect(resolveWindowHeight(coldLaunch({ windowHeight: MIN_WINDOW_HEIGHT }))).toBe(
      MIN_WINDOW_HEIGHT
    );
  });

  it("rides along with the rest of the offsets", () => {
    expect(resolveViewportOffsets(coldLaunch()).windowHeight).toBe(852);
  });
});

describe("launch-time relayout (what Agenda did by scrolling)", () => {
  it("asks for a layout pass while the layout viewport is short", () => {
    const out = resolveViewportOffsets(coldLaunch());
    expect(out.needsRelayout).toBe(true);
    expect(out.pan).toBe(0);
    expect(out.shrink).toBe(0);
  });

  it("asks for a layout pass when a bottom probe still misses the window edge", () => {
    expect(resolveViewportOffsets(metrics({ fixedGap: 34 })).needsRelayout).toBe(true);
  });

  it("keeps asking during the launch window even when geometry looks honest", () => {
    expect(resolveViewportOffsets(metrics({ sinceLaunch: 0 })).needsRelayout).toBe(true);
  });

  it("stands down after the launch window on an honest viewport", () => {
    expect(resolveViewportOffsets(metrics()).needsRelayout).toBe(false);
  });

  it("stands down once the correction has taken up the slack", () => {
    // Nothing left to measure: the probe carries the drop, so the residual is
    // zero even though the layout viewport is still short.
    const out = resolveViewportOffsets(
      metrics({ layoutHeight: 793, visibleHeight: 793, fixedDrop: 46, fixedGap: 0 })
    );
    expect(out.needsRelayout).toBe(false);
    expect(out.fixedDrop).toBe(46);
  });

  it("does not relayout while a keyboard session is open", () => {
    const out = resolveViewportOffsets(
      coldLaunch({ typing: true, visibleHeight: 552, offsetTop: 300 })
    );
    expect(out.needsRelayout).toBe(false);
  });

  it("does not touch chrome that isn't on screen", () => {
    const out = resolveViewportOffsets(coldLaunch({ phoneChrome: false }));
    expect(out.needsRelayout).toBe(false);
    expect(out.fixedDrop).toBe(0);
  });
});

describe("keyboard up", () => {
  it("pins panned chrome to the window edge", () => {
    const out = resolveViewportOffsets(
      metrics({ visibleHeight: 552, offsetTop: 300, typing: true })
    );
    expect(out.pan).toBe(300);
  });

  it("pins shrunken chrome by the same distance", () => {
    const out = resolveViewportOffsets(
      metrics({ layoutHeight: 552, visibleHeight: 552, typing: true, keyboardBase: 852 })
    );
    expect(out.shrink).toBe(300);
    expect(out.pan).toBe(0);
  });

  it("reports what is hidden below the visible area", () => {
    const out = resolveViewportOffsets(
      metrics({ visibleHeight: 452, offsetTop: 200, typing: true })
    );
    expect(out.keyboardInset).toBe(200);
  });

  it("holds the shrink correction through the close animation", () => {
    const out = resolveViewportOffsets(
      metrics({ layoutHeight: 818, visibleHeight: 818, typing: false, keyboardBase: 852 })
    );
    expect(out.shrink).toBe(34);
    expect(out.keyboardBase).toBe(852);
  });

  it("releases once the layout viewport is whole again", () => {
    const out = resolveViewportOffsets(metrics({ typing: false, keyboardBase: 852 }));
    expect(out.keyboardBase).toBeNull();
    expect(out.shrink).toBe(0);
  });

  it("clamps a stale base so rotating mid-edit can't shove chrome away for good", () => {
    const out = resolveViewportOffsets(
      metrics({ layoutHeight: 200, visibleHeight: 200, typing: true, keyboardBase: 1000 })
    );
    expect(out.shrink).toBe(200);
  });

  it("keeps out of a pan the user chose by pinching", () => {
    const out = resolveViewportOffsets(
      metrics({ visibleHeight: 552, offsetTop: 300, typing: true, scale: 2 })
    );
    expect(out.pan).toBe(0);
    expect(out.needsRelayout).toBe(false);
  });
});

describe("convergence", () => {
  /** Mirrors the hook's loop: the probe carries the drop, so each pass reads
   *  what is left over after the last one. */
  function converge(
    windowBottom: number,
    fixedBottomAt: number,
    passes = 6,
    dropHeadroom = 46
  ): number {
    let drop = 0;
    for (let i = 0; i < passes; i += 1) {
      drop = resolveFixedDrop(
        metrics({
          layoutHeight: fixedBottomAt,
          visibleHeight: windowBottom,
          dropHeadroom,
          fixedDrop: drop,
          fixedGap: windowBottom - (fixedBottomAt + drop),
        })
      );
    }
    return drop;
  }

  it("settles on the shortfall and stays there", () => {
    expect(converge(852, 818)).toBe(34);
  });

  it("settles on zero when nothing is wrong", () => {
    expect(converge(852, 852)).toBe(0);
  });

  it("settles at the clip budget on a shortfall bigger than the padding", () => {
    expect(converge(852, 793)).toBe(46);
  });

  it("settles at the ceiling rather than running away on a nonsense reading", () => {
    expect(converge(2000, 759, 8, 999)).toBe(MAX_FIXED_DROP);
  });
});
