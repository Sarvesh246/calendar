"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, RefreshCw } from "lucide-react";
import { motion as motionTokens } from "@/lib/motion";
import { useDatebookStore } from "@/lib/store";
import { fetchCalendarFeed } from "@/lib/calendar-import";
import { clearFeedBackoff, noteFeedFailure } from "@/lib/feed-retry";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";

export function FeedHealthBanner() {
  const sources = useDatebookStore((s) => s.importSources);
  const applyImport = useDatebookStore((s) => s.applyImport);
  const markImportError = useDatebookStore((s) => s.markImportError);
  const failed = sources.filter((s) => s.lastError);
  const [busy, setBusy] = useState<string | null>(null);
  return (
    // A feed recovering should slide the banner away, not make the page snap
    // upward by its height the instant the retry succeeds.
    <AnimatePresence initial={false}>
      {failed.length > 0 && (
        <motion.div
          key="feed-health"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{
            height: motionTokens.springLayout,
            opacity: { duration: motionTokens.micro },
          }}
          className="overflow-hidden"
        >
          <div className="flex flex-col gap-2 rounded-xl border border-warn/40 bg-warn/5 px-3.5 py-3">
          {failed.map((s) => (
            <div key={s.id} className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warn" strokeWidth={2} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">{s.name} couldn&apos;t sync</p>
                <p className="text-[12.5px] text-ink-soft">{s.lastError}</p>
                <p className="text-[11.5px] text-ink-faint">
                  Last ok {formatDistanceToNow(new Date(s.lastSyncedAt), { addSuffix: true })}
                </p>
              </div>
              <button
                type="button"
                disabled={busy === s.id}
                onClick={async () => {
                  setBusy(s.id);
                  // An explicit retry means now, not when the backoff says so.
                  clearFeedBackoff(s.url);
                  try {
                    const feed = await fetchCalendarFeed(s.url);
                    applyImport(s.url, feed);
                  } catch (err) {
                    noteFeedFailure(s.url, { lastSyncedAt: s.lastSyncedAt });
                    markImportError(s.url, err instanceof Error ? err.message : "Sync failed.");
                  } finally {
                    setBusy(null);
                  }
                }}
                className="flex min-h-9 items-center gap-1 rounded-md border border-line px-2.5 text-[12px] font-medium text-ink-soft hover:text-ink"
              >
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
                Retry
              </button>
            </div>
          ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
