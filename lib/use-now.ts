"use client";

import { useEffect, useState } from "react";

/** Refresh time-sensitive views on the minute and immediately after resuming. */
export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      if (document.visibilityState === "hidden") return;
      setNow(new Date());
      timer = setTimeout(update, 60_000 - Date.now() % 60_000 + 50);
    };
    timer = setTimeout(update, 0);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
    };
  }, []);
  return now;
}
