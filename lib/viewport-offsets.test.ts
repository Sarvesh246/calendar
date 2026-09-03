import { describe, expect, it } from "vitest";
import { MAX_SAFE_BOTTOM, resolveViewportOffsets, type ViewportMetrics } from "./viewport-offsets";

/** An iPhone-shaped installed app, at rest, with an honest cover viewport. */
function metrics(over: Partial<ViewportMetrics> = {}): ViewportMetrics {
  const layoutHeight = over.layoutHeight ?? 852;
  return {
    layoutHeight,
    layoutWidth: 393,
    innerHeight: layoutHeight,
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
    });
  });

  it("ignores a stale offsetTop while the viewport fills its layout viewport", () => {
    expect(resolveViewportOffsets(metrics({ offsetTop: 300 })).pan).toBe(0);
  });
});

describe("launch-time layout viewport that already excludes the home indicator", () => {
  it("strips env() padding so the inset is not counted twice", () => {
    const out = resolveViewportOffsets(metrics({ layoutHeight: 852 - 34 }));
    expect(out.safeBottom).toBe(0);
    expect(out.pan).toBe(0);
    expect(out.shrink).toBe(0);
  });

  it("restores padding the moment the layout viewport covers the screen", () => {
    expect(resolveViewportOffsets(metrics({ layoutHeight: 852 })).safeBottom).toBe(34);
  });

  it("strips padding when the visible area is taller than the layout viewport", () => {
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
  });

  it("leaves browser chrome padding alone when the shortfall is not a home indicator", () => {
    const out = resolveViewportOffsets(
      metrics({ standalone: false, layoutHeight: 780, screenHeight: 852 })
    );
    expect(out.safeBottom).toBe(34);
  });

  it("does not strip padding when the window does not span the screen's width", () => {
    const out = resolveViewportOffsets(metrics({ layoutHeight: 818, layoutWidth: 320 }));
    expect(out.safeBottom).toBe(34);
  });

  it("does not touch chrome that isn't on screen", () => {
    const out = resolveViewportOffsets(metrics({ phoneChrome: false, layoutHeight: 818 }));
    expect(out.safeBottom).toBe(34);
  });

  it("ignores a screen gap too large to be the home indicator", () => {
    expect(resolveViewportOffsets(metrics({ layoutHeight: 852 - 80 })).safeBottom).toBe(34);
  });

  it("clamps an inflated env() inset to the home-indicator ceiling", () => {
    expect(resolveViewportOffsets(metrics({ safeInset: 120 })).safeBottom).toBe(MAX_SAFE_BOTTOM);
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
  });
});
