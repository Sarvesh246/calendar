"use client";

import { useEffect, useRef } from "react";
import { useDatebookStore } from "@/lib/store";
import { fetchCalendarFeed } from "@/lib/calendar-import";

const INTERVAL_MS = 30 * 60 * 1000;

/** Re-fetch subscribed calendar feeds in the background. */
export function FeedSync() {
  const sources = useDatebookStore((s) => s.importSources);
  const applyImport = useDatebookStore((s) => s.applyImport);
  const running = useRef(false);

  useEffect(() => {
    if (sources.length === 0) return;

    async function syncAll() {
      if (running.current) return;
      running.current = true;
      try {
        for (const source of useDatebookStore.getState().importSources) {
          try {
            const feed = await fetchCalendarFeed(source.url);
            applyImport(source.url, feed);
          } catch (err) {
            console.warn("[datebook] feed sync failed", source.name, err);
          }
        }
      } finally {
        running.current = false;
      }
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") void syncAll();
    };
    const id = window.setInterval(() => void syncAll(), INTERVAL_MS);
    const boot = window.setTimeout(() => void syncAll(), 8000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(boot);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sources.length, applyImport]);

  return null;
}
