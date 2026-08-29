"use client";

import { useEffect, useState } from "react";

// Temporary diagnostic overlay for chasing the iOS standalone-PWA viewport
// bug (grey bars top/bottom, bottom nav floating off the screen edge).
// Enabled by ?debug=1 (which also flips a localStorage flag so it keeps
// showing after the page is re-launched from the home-screen icon, since
// the icon's start_url can't carry a query string). Remove once the bug's
// root cause is confirmed and fixed.
export function ViewportDebug() {
  const [enabled, setEnabled] = useState(false);
  const [info, setInfo] = useState<Record<string, string>>({});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let on = window.localStorage.getItem("debug-viewport") === "1";
    if (params.get("debug") === "1") {
      on = true;
      window.localStorage.setItem("debug-viewport", "1");
    } else if (params.get("debug") === "0") {
      on = false;
      window.localStorage.removeItem("debug-viewport");
    }
    setEnabled(on);
    if (!on) return;

    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;" +
      "padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);" +
      "padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);";
    document.body.appendChild(probe);

    const read = () => {
      const cs = getComputedStyle(probe);
      const vv = window.visualViewport;
      setInfo({
        innerWH: `${window.innerWidth}x${window.innerHeight}`,
        outerWH: `${window.outerWidth}x${window.outerHeight}`,
        screenWH: `${window.screen.width}x${window.screen.height}`,
        docClientWH: `${document.documentElement.clientWidth}x${document.documentElement.clientHeight}`,
        docScrollWH: `${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight}`,
        bodyScrollWH: `${document.body.scrollWidth}x${document.body.scrollHeight}`,
        vv: vv ? `${vv.width}x${vv.height} off(${vv.offsetLeft},${vv.offsetTop}) scale=${vv.scale}` : "n/a",
        safeArea: `T${cs.paddingTop} R${cs.paddingRight} B${cs.paddingBottom} L${cs.paddingLeft}`,
        dpr: String(window.devicePixelRatio),
        standalone: String((navigator as unknown as { standalone?: boolean }).standalone),
        displayModeStandalone: String(window.matchMedia("(display-mode: standalone)").matches),
        orientation: String(window.screen.orientation?.type ?? "n/a"),
        ua: navigator.userAgent.slice(0, 60),
      });
    };

    read();
    window.addEventListener("resize", read);
    window.visualViewport?.addEventListener("resize", read);
    const interval = setInterval(read, 1000);
    return () => {
      window.removeEventListener("resize", read);
      window.visualViewport?.removeEventListener("resize", read);
      clearInterval(interval);
      probe.remove();
    };
  }, []);

  if (!enabled) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        pointerEvents: "none",
        fontFamily: "monospace",
        fontSize: "9px",
        lineHeight: 1.4,
        color: "#0f0",
        background: "rgba(0,0,0,0.75)",
        padding: "2px 4px",
        whiteSpace: "pre-wrap",
        overflow: "hidden",
      }}
    >
      {Object.entries(info)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")}
    </div>
  );
}
