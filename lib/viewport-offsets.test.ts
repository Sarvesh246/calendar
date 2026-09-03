import { describe, expect, it } from "vitest";
import {
  LAUNCH_WINDOW_MS,
  MAX_REST_CORRECTION,
  resolveViewportOffsets,
  type ViewportMetrics,
} from "./viewport-offsets";

/** An iPhone-shaped installed app, at rest, with an honest viewport. Unless a
 *  case says otherwise the visible area matches the layout viewport, which is
 *  how a real browser reports a layout viewport of any size. */
function metrics(over: Partial<ViewportMetrics> = {}): ViewportMetrics {
  const layoutHeight = over.layoutHeight ?? 852;
  return {
    layoutHeight,
    layoutWidth: 393,
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
    expect(resolveViewportOffsets(metrics())).toMatchObject({
      pan: 0,
      shrink: 0,
      underflow: 0,
      keyboardInset: 0,
      needsRelayout: false,
    });
  });

  it("ignores a stale offsetTop while the viewport fills its layout viewport", () => {
    // The cold-launch reading that used to leave the bar floating above the
    // keyboard's old position: a positive offsetTop is meaningless when nothing
    // is covering the window.
    expect(resolveViewportOffsets(metrics({ offsetTop: 300 })).pan).toBe(0);
  });
});

describe("launch-time layout viewport that falls short of the window", () => {
  it("pushes bottom chrome down by the inset iOS counted twice", () => {
    // `viewport-fit: cover` not applied yet: the layout viewport stops above the
    // home indicator, so `bottom: 0` plus the bar's own 34px safe-area padding
    // parks it 34px clear of the window edge.
    const out = resolveViewportOffsets(metrics({ layoutHeight: 852 - 34 }));
    expect(out.underflow).toBe(34);
    expect(out.needsRelayout).toBe(true);
    expect(out.pan).toBe(0);
    expect(out.shrink).toBe(0);
  });

  it("dissolves the moment the browser corrects its own viewport", () => {
    const out = resolveViewportOffsets(metrics({ layoutHeight: 852, sinceLaunch: 800 }));
    expect(out.underflow).toBe(0);
    expect(out.needsRelayout).toBe(false);
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

  it("stands the screen check down once the launch window has passed", () => {
    const out = resolveViewportOffsets(
      metrics({ layoutHeight: 852 - 34, sinceLaunch: LAUNCH_WINDOW_MS + 1 })
    );
    expect(out.underflow).toBe(0);
  });

  it("keeps out of it when the window does not span the screen's width", () => {
    // iPad Split View, or a resized desktop PWA: the screen says nothing about
    // how tall this window is meant to be.
    const out = resolveViewportOffsets(metrics({ layoutHeight: 852 - 34, layoutWidth: 320 }));
    expect(out.underflow).toBe(0);
  });

  it("leaves browser chrome alone", () => {
    // In a tab the layout viewport is legitimately shorter than the screen.
    const out = resolveViewportOffsets(metrics({ standalone: false, layoutHeight: 780 }));
    expect(out.underflow).toBe(0);
  });

  it("does not touch chrome that isn't on screen", () => {
    // Above 768px the tab bar and FAB are `md:hidden`; nothing to correct.
    const out = resolveViewportOffsets(
      metrics({ phoneChrome: false, layoutHeight: 852 - 34 })
    );
    expect(out.underflow).toBe(0);
  });

  it("refuses a gap too large to be a safe-area inset", () => {
    // A picker or an autofill bar shrinks the layout viewport without focusing a
    // text field. Anything keyboard-sized is not a mis-resolved viewport.
    expect(resolveViewportOffsets(metrics({ layoutHeight: 852 - 300 })).underflow).toBe(0);
    // Right up to the ceiling it still corrects; one pixel past it stands down.
    expect(
      resolveViewportOffsets(metrics({ layoutHeight: 852 - MAX_REST_CORRECTION })).underflow
    ).toBe(MAX_REST_CORRECTION);
    expect(
      resolveViewportOffsets(metrics({ layoutHeight: 852 - MAX_REST_CORRECTION - 1 })).underflow
    ).toBe(0);
  });

  it("ignores sub-pixel rounding", () => {
    expect(resolveViewportOffsets(metrics({ visibleHeight: 852.4, layoutHeight: 851 })).underflow)
      .toBe(0);
    expect(resolveViewportOffsets(metrics({ visibleHeight: 855.6, layoutHeight: 851 })).underflow)
      .toBe(5);
  });

  it("keeps out of a pan the user chose by pinching", () => {
    const out = resolveViewportOffsets(metrics({ scale: 2, layoutHeight: 852 - 34 }));
    expect(out.underflow).toBe(0);
  });
});

describe("keyboard up", () => {
  it("pins panned chrome to the window edge", () => {
    // iOS in a tab: layout viewport unchanged, visual viewport scrolled up.
    const out = resolveViewportOffsets(
      metrics({ visibleHeight: 552, offsetTop: 300, typing: true })
    );
    expect(out.pan).toBe(300);
    expect(out.underflow).toBe(0);
  });

  it("pins shrunken chrome by the same distance", () => {
    // iOS standalone: the layout viewport itself shortens.
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
    // Focus has gone but the keyboard is still on screen, so the layout viewport
    // has not come back yet. The shrink term carries it; the resting correction
    // must not also fire against the same gap.
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
});
