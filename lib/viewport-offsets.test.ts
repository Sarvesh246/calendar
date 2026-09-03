import { describe, expect, it } from "vitest";
import {
  LAUNCH_WINDOW_MS,
  MAX_SAFE_BOTTOM,
  resolveSafeBottom,
  resolveViewportOffsets,
  type ViewportMetrics,
} from "./viewport-offsets";

/** An iPhone-shaped installed app, at rest, with an honest cover viewport.
 *  `sinceLaunch` defaults past the launch window so resting tests do not
 *  inherit the Agenda-style relayout that is only armed after a cold start. */
function metrics(over: Partial<ViewportMetrics> = {}): ViewportMetrics {
  const layoutHeight = over.layoutHeight ?? 852;
  return {
    layoutHeight,
    layoutWidth: 393,
    innerHeight: layoutHeight,
    chromeGap: 0,
    visibleHeight: layoutHeight,
    offsetTop: 0,
    scale: 1,
    screenHeight: 852,
    screenWidth: 393,
    safeInset: 34,
    standalone: true,
    phoneChrome: true,
    typing: false,
    keyboardBase: null,
    sinceLaunch: LAUNCH_WINDOW_MS + 1,
    ...over,
  };
}

describe("at rest", () => {
  it("keeps the home-indicator padding when the viewport already covers the screen", () => {
    expect(resolveViewportOffsets(metrics())).toMatchObject({
      pan: 0,
      shrink: 0,
      keyboardInset: 0,
      safeBottom: 34,
      needsRelayout: false,
    });
  });

  it("ignores a stale offsetTop while the viewport fills its layout viewport", () => {
    expect(resolveViewportOffsets(metrics({ offsetTop: 300 })).pan).toBe(0);
  });
});

describe("safe-area padding", () => {
  it("does not strip padding just because screen.height is a home-indicator taller", () => {
    // The regression that sat the pill on the physical bottom edge: iOS
    // reports a 34px screen gap on an already-honest layout viewport
    // (Dynamic Island / Display Zoom). Subtracting it dropped --safe-bottom
    // to 0 on every screen.
    const out = resolveViewportOffsets(
      metrics({ layoutHeight: 852, visibleHeight: 852, screenHeight: 852 + 34 })
    );
    expect(out.safeBottom).toBe(34);
    expect(out.needsRelayout).toBe(false);
  });

  it("does not strip padding when visual and layout agree, even if both are short of the screen", () => {
    // Relayout's job, not padding's. Zeroing env() here is what made the bar
    // too low; Agenda then looked right only because scrolling grew the layout.
    const out = resolveViewportOffsets(
      metrics({ layoutHeight: 818, visibleHeight: 818, screenHeight: 852 })
    );
    expect(out.safeBottom).toBe(34);
  });

  it("subtracts only the visible overlap, not the whole inset", () => {
    expect(resolveSafeBottom(metrics({ layoutHeight: 832, visibleHeight: 852 }))).toBe(14);
  });

  it("strips env() padding only when the visible area is actually taller than the layout", () => {
    const out = resolveViewportOffsets(
      metrics({
        standalone: false,
        screenHeight: 0,
        screenWidth: 0,
        layoutHeight: 818,
        visibleHeight: 852,
        safeInset: 34,
      })
    );
    expect(out.safeBottom).toBe(0);
    expect(out.needsRelayout).toBe(true);
  });

  it("restores padding the moment the layout viewport covers the screen", () => {
    expect(resolveViewportOffsets(metrics({ layoutHeight: 852 })).safeBottom).toBe(34);
  });

  it("leaves browser chrome padding alone when the shortfall is not visible", () => {
    const out = resolveViewportOffsets(
      metrics({ standalone: false, layoutHeight: 780, visibleHeight: 780, screenHeight: 852 })
    );
    expect(out.safeBottom).toBe(34);
  });

  it("does not touch chrome that isn't on screen", () => {
    const out = resolveViewportOffsets(metrics({ phoneChrome: false, layoutHeight: 818 }));
    expect(out.safeBottom).toBe(34);
    expect(out.needsRelayout).toBe(false);
  });

  it("clamps an inflated env() inset to the ceiling", () => {
    expect(resolveSafeBottom(metrics({ safeInset: 120 }))).toBe(MAX_SAFE_BOTTOM);
  });

  it("keeps a 48px Android inset instead of clipping it to the iOS home indicator", () => {
    expect(resolveSafeBottom(metrics({ safeInset: 48 }))).toBe(48);
  });

  it("keeps full padding while typing so the bar does not jump when the keyboard opens", () => {
    expect(resolveSafeBottom(metrics({ typing: true, visibleHeight: 552, offsetTop: 300 }))).toBe(34);
  });
});

describe("launch-time relayout (what Agenda did by scrolling)", () => {
  it("asks for a layout pass during the launch window even when geometry looks honest", () => {
    const out = resolveViewportOffsets(metrics({ sinceLaunch: 0 }));
    expect(out.safeBottom).toBe(34);
    expect(out.needsRelayout).toBe(true);
    expect(out.pan).toBe(0);
    expect(out.shrink).toBe(0);
  });

  it("asks for a layout pass when a bottom probe still sits above the visual edge", () => {
    const out = resolveViewportOffsets(metrics({ chromeGap: 34 }));
    expect(out.needsRelayout).toBe(true);
    expect(out.safeBottom).toBe(34);
    expect(out.pan).toBe(0);
  });

  it("does not treat a keyboard-sized probe gap as stale fixed chrome", () => {
    expect(resolveViewportOffsets(metrics({ chromeGap: 300 })).needsRelayout).toBe(false);
  });

  it("stands down after the launch window on an honest viewport", () => {
    expect(resolveViewportOffsets(metrics({ sinceLaunch: LAUNCH_WINDOW_MS + 1 })).needsRelayout).toBe(
      false
    );
  });

  it("does not relayout while a keyboard session is open", () => {
    const out = resolveViewportOffsets(
      metrics({ sinceLaunch: 0, typing: true, visibleHeight: 552, offsetTop: 300, chromeGap: 34 })
    );
    expect(out.needsRelayout).toBe(false);
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
