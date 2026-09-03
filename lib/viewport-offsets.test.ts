import { describe, expect, it } from "vitest";
import {
  LAUNCH_WINDOW_MS,
  MAX_REST_CORRECTION,
  resolveViewportOffsets,
  type ViewportMetrics,
} from "./viewport-offsets";

/** An iPhone-shaped installed app, at rest, with an honest viewport. Unless a
 *  case says otherwise the visible area matches the layout viewport. */
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
    standalone: true,
    phoneChrome: true,
    typing: false,
    keyboardBase: null,
    sinceLaunch: 120,
    ...over,
  };
}

describe("at rest", () => {
  it("moves nothing when the viewport is honest", () => {
    expect(
      resolveViewportOffsets(metrics({ sinceLaunch: LAUNCH_WINDOW_MS + 1 }))
    ).toMatchObject({
      pan: 0,
      shrink: 0,
      underflow: 0,
      keyboardInset: 0,
      needsRelayout: false,
    });
  });

  it("ignores a stale offsetTop while the viewport fills its layout viewport", () => {
    expect(resolveViewportOffsets(metrics({ offsetTop: 300 })).pan).toBe(0);
  });
});

describe("launch-time layout viewport that falls short of the window", () => {
  it("translates bottom chrome down while the layout viewport is still short", () => {
    // Visible area is taller than the stale layout viewport — the primary
    // signal that the layout hasn't caught up yet.
    const out = resolveViewportOffsets(
      metrics({ layoutHeight: 852 - 34, visibleHeight: 852 })
    );
    expect(out.underflow).toBe(34);
    expect(out.needsRelayout).toBe(true);
    expect(out.pan).toBe(0);
    expect(out.shrink).toBe(0);
  });

  it("stops translating once the layout viewport is whole", () => {
    const out = resolveViewportOffsets(metrics({ layoutHeight: 852, sinceLaunch: 800 }));
    expect(out.underflow).toBe(0);
    expect(out.needsRelayout).toBe(true);
  });

  it("relayouts instead of translating when the layout is whole but fixed chrome is stale", () => {
    const out = resolveViewportOffsets(
      metrics({ layoutHeight: 852, visibleHeight: 852, innerHeight: 852, chromeGap: 34 })
    );
    expect(out.underflow).toBe(0);
    expect(out.needsRelayout).toBe(true);
  });

  it("corrects a visible area taller than the layout viewport, standalone or not", () => {
    const out = resolveViewportOffsets(
      metrics({
        standalone: false,
        screenHeight: 0,
        screenWidth: 0,
        layoutHeight: 800,
        visibleHeight: 852,
      })
    );
    expect(out.underflow).toBe(52);
  });

  it("does not nudge relayout once the launch window has passed with an honest viewport", () => {
    const out = resolveViewportOffsets(metrics({ sinceLaunch: LAUNCH_WINDOW_MS + 1 }));
    expect(out.needsRelayout).toBe(false);
  });

  it("stands the screen check down once the launch window has passed", () => {
    const out = resolveViewportOffsets(
      metrics({ layoutHeight: 852 - 34, sinceLaunch: LAUNCH_WINDOW_MS + 1 })
    );
    expect(out.underflow).toBe(0);
  });

  it("keeps out of it when the window does not span the screen's width", () => {
    const out = resolveViewportOffsets(metrics({ layoutHeight: 852 - 34, layoutWidth: 320 }));
    expect(out.underflow).toBe(0);
  });

  it("leaves browser chrome alone", () => {
    const out = resolveViewportOffsets(metrics({ standalone: false, layoutHeight: 780 }));
    expect(out.underflow).toBe(0);
  });

  it("does not touch chrome that isn't on screen", () => {
    const out = resolveViewportOffsets(
      metrics({ phoneChrome: false, layoutHeight: 852 - 34 })
    );
    expect(out.underflow).toBe(0);
  });

  it("refuses a gap too large to be a safe-area inset", () => {
    expect(resolveViewportOffsets(
      metrics({ layoutHeight: 852 - 300, visibleHeight: 852 })
    ).underflow).toBe(0);
    expect(resolveViewportOffsets(
      metrics({ layoutHeight: 852 - MAX_REST_CORRECTION, visibleHeight: 852 })
    ).underflow).toBe(MAX_REST_CORRECTION);
    expect(resolveViewportOffsets(
      metrics({ layoutHeight: 852 - MAX_REST_CORRECTION - 1, visibleHeight: 852 })
    ).underflow).toBe(0);
  });

  it("refuses a stale-fixed relayout nudge for a keyboard-sized probe gap", () => {
    const out = resolveViewportOffsets(
      metrics({ layoutHeight: 852, chromeGap: 300, sinceLaunch: LAUNCH_WINDOW_MS + 1 })
    );
    expect(out.underflow).toBe(0);
    expect(out.needsRelayout).toBe(false);
  });
});

describe("keyboard up", () => {
  it("pins panned chrome to the window edge", () => {
    const out = resolveViewportOffsets(
      metrics({ visibleHeight: 552, offsetTop: 300, typing: true })
    );
    expect(out.pan).toBe(300);
    expect(out.underflow).toBe(0);
  });

  it("pins shrunken chrome by the same distance", () => {
    const out = resolveViewportOffsets(
      metrics({ layoutHeight: 552, visibleHeight: 552, typing: true, keyboardBase: 852 })
    );
    expect(out.shrink).toBe(300);
    expect(out.pan).toBe(0);
    expect(out.underflow).toBe(0);
  });

  it("reports what is hidden below the visible area", () => {
    const out = resolveViewportOffsets(
      metrics({ visibleHeight: 452, offsetTop: 200, typing: true })
    );
    expect(out.keyboardInset).toBe(200);
  });

  it("holds the correction through the close animation, without double-counting", () => {
    const out = resolveViewportOffsets(
      metrics({ layoutHeight: 818, visibleHeight: 818, typing: false, keyboardBase: 852 })
    );
    expect(out.shrink).toBe(34);
    expect(out.underflow).toBe(0);
    expect(out.keyboardBase).toBe(852);
  });

  it("releases once the layout viewport is whole again", () => {
    const out = resolveViewportOffsets(metrics({ typing: false, keyboardBase: 852 }));
    expect(out.keyboardBase).toBeNull();
    expect(out.shrink).toBe(0);
    expect(out.underflow).toBe(0);
  });

  it("clamps a stale base so rotating mid-edit can't shove chrome away for good", () => {
    const out = resolveViewportOffsets(
      metrics({ layoutHeight: 200, visibleHeight: 200, typing: true, keyboardBase: 1000 })
    );
    expect(out.shrink).toBe(200);
  });

  it("keeps out of a pan the user chose by pinching", () => {
    const out = resolveViewportOffsets(
      metrics({ scale: 2, layoutHeight: 852 - 34 })
    );
    expect(out.underflow).toBe(0);
  });
});
