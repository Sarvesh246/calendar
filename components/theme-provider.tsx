"use client";

import { useEffect } from "react";
import { useDatebookStore } from "@/lib/store";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const preset = useDatebookStore((s) => s.settings.preset);

  useEffect(() => {
    document.documentElement.setAttribute("data-preset", preset);
  }, [preset]);

  return <>{children}</>;
}

/** Inline, blocking script to set the preset before first paint — avoids a flash of the default theme. */
export const themeInitScript = `
(function () {
  try {
    var raw = localStorage.getItem("datebook-store");
    if (!raw) return;
    var parsed = JSON.parse(raw);
    var preset = parsed && parsed.state && parsed.state.settings && parsed.state.settings.preset;
    if (preset) document.documentElement.setAttribute("data-preset", preset);
  } catch (e) {}
})();
`;
