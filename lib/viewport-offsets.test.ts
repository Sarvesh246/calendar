import { describe, expect, it } from "vitest";
import { resolveViewportOffsets, type ViewportMetrics } from "./viewport-offsets";

/** An iPhone-shaped viewport, at rest, with an honest layout viewport. */
function metrics(over: Partial<ViewportMetrics> = {}): ViewportMetrics {
  const layoutHeight = over.layoutHeight ?? 852;
  return {
    layoutHeight,
    visibleHeight: layoutHeight,
    offsetTop: 0,
    scale: 1,
    typing: false,
    keyboardBase: null,
    ...over,
  };
}

describe("at rest", () => {
  it("moves nothing when the viewport is honest", () => {
    expect(resolveViewportOffsets(metrics())).toMatchObject({
      pan: 0,
      shrink: 0,
      keyboardInset: 0,
    });
  });

  it("ignores a stale offsetTop while the viewport fills its layout viewport", () => {
    // A positive offsetTop is meaningless when nothing is covering the window —
    // this is what keeps the resting chrome from ever being displaced by a
    // reading that has nothing to correct.
    expect(resolveViewportOffsets(metrics({ offsetTop: 300 })).pan).toBe(0);
  });
});

describe("keyboard up", () => {
  it("pins panned chrome to the window edge", () => {
    // iOS in a tab: layout viewport unchanged, visual viewport scrolled up.
    const out = resolveViewportOffsets(
      metrics({ visibleHeight: 552, offsetTop: 300, typing: true })
    );
    expect(out.pan).toBe(300);
  });

  it("pins shrunken chrome by the same distance", () => {
    // iOS standalone: the layout viewport itself shortens.
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

  it("holds the correction through the close animation", () => {
    // Focus has gone but the keyboard is still on screen, so the layout
    // viewport has not come back yet.
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
