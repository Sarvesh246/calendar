"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Rect = { width: string; height: string; transform: string };

function readViewport(): Rect {
  if (typeof window === "undefined" || !window.visualViewport) {
    return { width: "100%", height: "100%", transform: "none" };
  }
  const vv = window.visualViewport;
  return {
    width: `${vv.width}px`,
    height: `${vv.height}px`,
    transform: `translate(${vv.offsetLeft}px, ${vv.offsetTop}px)`,
  };
}

/**
 * A `position: fixed` layer that exactly overlays the **visual** viewport — the
 * region *not* covered by the on-screen keyboard — and follows it live as the
 * keyboard animates in and out.
 *
 * iOS lays `position: fixed` out against the layout viewport and then paints it
 * shifted by the visual viewport's scroll, so a plain `fixed; bottom: 0` sheet
 * drifts up off-screen when the keyboard opens. Translating by
 * `visualViewport.offset*` (the pattern from the VisualViewport spec) cancels
 * that shift. Anchor a sheet to the bottom of this layer and it sits cleanly
 * just above the keyboard on every platform.
 */
export function ViewportLayer({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  const [initial] = useState(readViewport);

  useEffect(() => {
    const el = ref.current;
    const vv = window.visualViewport;
    if (!el || !vv) return;

    let raf = 0;
    const sync = () => {
      raf = 0;
      el.style.width = `${vv.width}px`;
      el.style.height = `${vv.height}px`;
      el.style.transform = `translate(${vv.offsetLeft}px, ${vv.offsetTop}px)`;
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(sync);
    };

    sync();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`fixed left-0 top-0 origin-top-left ${className ?? ""}`}
      style={initial}
      {...rest}
    >
      {children}
    </div>
  );
}
