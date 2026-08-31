"use client";

import { useEffect, useState } from "react";
import { FeedSync } from "./feed-sync";

/** Mount feed sync after first paint so launch stays fast. */
export function DeferredFeedSync() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const start = () => setReady(true);
    if (typeof requestIdleCallback !== "undefined") {
      const id = requestIdleCallback(start, { timeout: 2000 });
      return () => cancelIdleCallback(id);
    }
    const t = setTimeout(start, 800);
    return () => clearTimeout(t);
  }, []);

  return ready ? <FeedSync /> : null;
}
