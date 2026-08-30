"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Check, Link2, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { motion as motionTokens } from "@/lib/motion";
import { useDatebookStore } from "@/lib/store";
import { fetchCalendarFeed, normalizeFeedUrl } from "@/lib/calendar-import";
import { cn } from "@/lib/utils";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "success"; message: string };

export function ImportCalendar() {
  const sources = useDatebookStore((s) => s.importSources);
  const applyImport = useDatebookStore((s) => s.applyImport);
  const removeImportSource = useDatebookStore((s) => s.removeImportSource);

  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function runImport(feedUrl: string) {
    const normalized = normalizeFeedUrl(feedUrl);
    if (!normalized) return;
    setStatus({ kind: "loading" });
    try {
      const feed = await fetchCalendarFeed(normalized);
      const { added, updated, removed } = applyImport(normalized, feed);
      setStatus({ kind: "success", message: summarize(added, updated, removed) });
      setUrl("");
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Import failed." });
    }
  }

  async function resync(id: string, feedUrl: string) {
    setSyncingId(id);
    setStatus({ kind: "idle" });
    try {
      const feed = await fetchCalendarFeed(feedUrl);
      const { added, updated, removed } = applyImport(feedUrl, feed);
      setStatus({ kind: "success", message: summarize(added, updated, removed) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Re-sync failed.";
      useDatebookStore.getState().markImportError(feedUrl, message);
      setStatus({ kind: "error", message });
    } finally {
      setSyncingId(null);
    }
  }

  const busy = status.kind === "loading";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 sm:flex-row sm:items-center">
        <Link2 className="h-4 w-4 shrink-0 text-ink-faint" strokeWidth={1.75} />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && url.trim() && !busy && runImport(url)}
          placeholder="Paste a calendar feed link (Canvas, Google, Outlook…)"
          spellCheck={false}
          autoCapitalize="off"
          className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink placeholder:text-ink-faint focus:outline-none"
        />
        <button
          onClick={() => url.trim() && runImport(url)}
          disabled={!url.trim() || busy}
          className="flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-[12.5px] font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-30"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
          {busy ? "Importing" : "Import"}
        </button>
      </div>

      <AnimatePresence initial={false} mode="wait">
        {(status.kind === "error" || status.kind === "success") && (
          <motion.p
            key={status.kind + status.message}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
            className={cn(
              "flex items-start gap-1.5 text-[12.5px]",
              status.kind === "error" ? "text-warn" : "text-good"
            )}
          >
            {status.kind === "error" ? (
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            ) : (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
            )}
            {status.message}
          </motion.p>
        )}
      </AnimatePresence>

      {sources.length > 0 && (
        <div className="flex flex-col gap-2">
          {sources.map((source) => (
            <div
              key={source.id}
              className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium text-ink">{source.name}</p>
                  <p className="truncate text-[11.5px] text-ink-faint">
                    {source.itemCount} item{source.itemCount === 1 ? "" : "s"} · synced{" "}
                    {formatDistanceToNow(new Date(source.lastSyncedAt), { addSuffix: true })}
                  </p>
                  {source.lastError && (
                    <p className="mt-0.5 text-[12px] text-warn">{source.lastError}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => resync(source.id, source.url)}
                    disabled={syncingId !== null}
                    aria-label="Re-sync"
                    className="flex h-11 w-11 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-40"
                  >
                    <RefreshCw
                      className={cn("h-3.5 w-3.5", syncingId === source.id && "animate-spin")}
                      strokeWidth={1.9}
                    />
                  </button>
                  <button
                    onClick={() => setConfirmId(confirmId === source.id ? null : source.id)}
                    aria-label="Remove"
                    className="flex h-11 w-11 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-surface-sunken hover:text-warn"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                  </button>
                </div>
              </div>

              {confirmId === source.id && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  transition={{
                    height: motionTokens.springLayout,
                    opacity: { duration: motionTokens.micro },
                  }}
                  className="flex flex-wrap items-center gap-2 overflow-hidden border-t border-line pt-2"
                >
                  <span className="text-[12px] text-ink-soft">Remove this feed and…</span>
                  <button
                    onClick={() => {
                      removeImportSource(source.id, false);
                      setConfirmId(null);
                    }}
                    className="rounded-md border border-line px-2 py-1 text-[12px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
                  >
                    keep its items
                  </button>
                  <button
                    onClick={() => {
                      removeImportSource(source.id, true);
                      setConfirmId(null);
                    }}
                    className="rounded-md border border-warn/40 px-2 py-1 text-[12px] font-medium text-warn transition-colors hover:bg-warn/10"
                  >
                    delete its items
                  </button>
                </motion.div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function summarize(added: number, updated: number, removed: number): string {
  const parts: string[] = [];
  if (added) parts.push(`${added} added`);
  if (updated) parts.push(`${updated} updated`);
  if (removed) parts.push(`${removed} removed`);
  return parts.length ? parts.join(" · ") : "Already up to date.";
}
