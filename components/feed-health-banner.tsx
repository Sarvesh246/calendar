"use client";

import { AlertCircle, RefreshCw } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { fetchCalendarFeed } from "@/lib/calendar-import";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";

export function FeedHealthBanner() {
  const sources = useDatebookStore((s) => s.importSources);
  const applyImport = useDatebookStore((s) => s.applyImport);
  const failed = sources.filter((s) => s.lastError);
  const [busy, setBusy] = useState<string | null>(null);
  if (failed.length === 0) return null;

  return (
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
              try {
                const feed = await fetchCalendarFeed(s.url);
                applyImport(s.url, feed);
              } catch {
                /* markImportError already set by fetch path if we wire it */
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
  );
}
