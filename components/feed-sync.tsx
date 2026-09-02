"use client";

import { useEffect, useRef } from "react";
import { useDatebookStore } from "@/lib/store";
import { fetchCalendarFeed } from "@/lib/calendar-import";

const INTERVAL_MS = 30 * 60 * 1000;
// A feed's `lastSyncedAt` syncs across devices, so this also stops a phone and a
// laptop from both re-pulling (and re-writing) the same feed minutes apart.
const STALE_MS = 25 * 60 * 1000;

function isStale(lastSyncedAt: string) {
  const t = Date.parse(lastSyncedAt);
  return Number.isNaN(t) || Date.now() - t > STALE_MS;
}

/** Re-fetch subscribed calendar feeds in the background. */
export function FeedSync() {
  const sources = useDatebookStore((s) => s.importSources);
  const applyImport = useDatebookStore((s) => s.applyImport);
  const running = useRef(false);

  useEffect(() => {
    if (sources.length === 0) return;

    async function syncAll() {
      if (running.current) return;
      if (!useDatebookStore.persist.hasHydrated()) return;
      running.current = true;
      try {
        for (const source of useDatebookStore.getState().importSources) {
          if (!isStale(source.lastSyncedAt)) continue;
          try {
            const feed = await fetchCalendarFeed(source.url);
            applyImport(source.url, feed);
          } catch (err) {
            const message = err instanceof Error ? err.message : "Re-sync failed.";
            useDatebookStore.getState().markImportError(source.url, message);
            console.warn("[datebook] feed sync failed", source.name, err);
          }
        }
      } finally {
        running.current = false;
      }
    }

    let intervalId = 0;
    let bootId = 0;
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncAll();
    };

    function arm() {
      intervalId = window.setInterval(() => void syncAll(), INTERVAL_MS);
      bootId = window.setTimeout(() => void syncAll(), 8000);
      document.addEventListener("visibilitychange", onVisible);
    }

    const persist = useDatebookStore.persist;
    if (persist.hasHydrated()) {
      arm();
    } else {
      const unsub = persist.onFinishHydration(arm);
      return () => {
        unsub();
        window.clearInterval(intervalId);
        window.clearTimeout(bootId);
        document.removeEventListener("visibilitychange", onVisible);
      };
    }

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(bootId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sources.length, applyImport]);

  return null;
}
