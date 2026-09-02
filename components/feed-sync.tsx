"use client";

import { useEffect, useRef } from "react";
import { useDatebookStore } from "@/lib/store";
import { fetchCalendarFeed, FeedFetchError } from "@/lib/calendar-import";
import { mayAttempt, noteFeedFailure, noteFeedSuccess } from "@/lib/feed-retry";

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
          // Two gates, for two different reasons: `lastSyncedAt` is shared, so
          // it keeps every device from re-pulling the same feed; the backoff is
          // local, so a device that was just turned away waits its turn instead
          // of asking again on the next tab focus — which is what kept the
          // rate limit permanently tripped.
          if (!isStale(source.lastSyncedAt)) continue;
          if (!mayAttempt(source.url)) continue;
          try {
            const feed = await fetchCalendarFeed(source.url);
            applyImport(source.url, feed);
            noteFeedSuccess(source.url);
          } catch (err) {
            const rateLimited = err instanceof FeedFetchError && err.rateLimited;
            const { surface } = noteFeedFailure(source.url, {
              rateLimited,
              lastSyncedAt: source.lastSyncedAt,
            });
            // Waiting out a rate limit isn't news — the calendar on screen is
            // still right, just not re-checked this minute.
            if (surface) {
              const message = err instanceof Error ? err.message : "Re-sync failed.";
              useDatebookStore.getState().markImportError(source.url, message);
            }
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
