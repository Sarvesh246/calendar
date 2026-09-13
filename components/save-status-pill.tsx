"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, CloudOff, RotateCw, TriangleAlert } from "lucide-react";
import {
  getLocalWriteCount,
  getServerLocalWriteCount,
  subscribeLocalWrites,
  useDatebookStore,
} from "@/lib/store";
import { describeSaveStatus, type SaveStatusView } from "@/lib/save-status";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** How long a purely reassuring message stays up. */
const TRANSIENT_MS = 2200;

/**
 * Quiet, contextual proof that your edit landed.
 *
 * Deliberately not a toast: it never covers content, never steals focus, and
 * only appears at all once you have actually changed something this session —
 * showing "Saved" to someone who has just opened the app is noise about a thing
 * they weren't worried about.
 *
 * A reassurance ("Saved on this device") fades on its own. Anything you might
 * want to act on — queued writes, no connection, a failed push — stays until
 * the state itself resolves, and a failure brings its own Retry.
 */
export function SaveStatusPill() {
  const mode = useDatebookStore((s) => s.mode);
  const syncStatus = useDatebookStore((s) => s.syncStatus);
  const queued = useDatebookStore((s) => s.queuedWrites);
  const online = useDatebookStore((s) => s.online);
  const cloudError = useDatebookStore((s) => s.cloudError);
  const retrySync = useDatebookStore((s) => s.retrySync);

  const view = describeSaveStatus({ mode, syncStatus, online, queued, error: cloudError });
  const [visible, setVisible] = useState(false);

  // Only speak for writes the user made. The store's own startup churn
  // (hydration, the first cloud reconcile) must not put a status on screen.
  const writes = useWriteTick();

  // `view` is rebuilt every render, so the effect keys off its identity plus
  // the write counter: a fresh edit re-shows the pill (and restarts its timer)
  // even when the wording is unchanged, and a change of state — going offline,
  // a push failing — shows it without waiting for another edit.
  const key = `${view.tone}|${view.title}|${view.detail ?? ""}`;
  // Rebuilt cheaply from the same inputs the effect already depends on, so the
  // effect can read it without holding a ref it would have to write in render.
  const transient = view.transient;

  // A reassurance is worth saying once. "Saved" on every single edit, forever,
  // is a pill that lives on screen and stops being read — and it was covering
  // the list while it did it. Anything you might need to act on ignores this
  // and shows every time.
  const reassured = useRef(false);

  useEffect(() => {
    if (writes === 0) return;
    if (transient) {
      if (reassured.current) return;
      reassured.current = true;
    }
    // Showing is the effect: it is driven by writes landing and by the sync
    // state changing underneath, neither of which is a render-time value.
    setVisible(true);
    if (!transient) return;
    const t = setTimeout(() => setVisible(false), TRANSIENT_MS);
    return () => clearTimeout(t);
  }, [key, writes, transient]);

  // Rendered live rather than from a snapshot, so a queue that drains while the
  // card is up turns "Waiting to sync" into "Saved" instead of lying until the
  // next edit.
  const current = view;

  return (
    // Positioned by `ToastViewport`, in the same column as the undo snackbars:
    // both live just above the tab bar, and two things laying claim to that
    // strip independently is how they ended up on top of each other.
    // The right gutter keeps it clear of the add button: an undo snackbar covers
    // that for a few seconds and nobody minds, but "Waiting to sync" stays until
    // the network comes back, and it must not sit on top of Add for that long.
    <div
      className={cn(
        "save-status-pill flex w-full justify-center md:hidden",
        // Only a status that sticks around needs to dodge the add button. A
        // "Saved" that fades in two seconds can sit dead centre, which is
        // where the eye expects it — the permanent right gutter was making
        // every pill look accidentally off to one side.
        current && !current.transient && "pr-[4.5rem]"
      )}
    >
      <AnimatePresence mode="popLayout">
        {visible && current && (
          <motion.div
            key="save-status"
            role="status"
            aria-live="polite"
            layout
            initial={{ opacity: 0, y: 10, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{
              opacity: 0,
              y: 6,
              scale: 0.96,
              filter: "blur(2px)",
              transition: { duration: motionTokens.standard, ease: motionTokens.easeIn },
            }}
            transition={motionTokens.springGentle}
            // Flick it away, the way you would a notification. Snapping back
            // on a short drag means a half-hearted swipe never leaves the pill
            // stranded off-centre.
            drag="y"
            dragDirectionLock
            dragSnapToOrigin
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.06, bottom: 0.7 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 28 || info.velocity.y > 420) setVisible(false);
            }}
            className={cn(
              "sync-notice-card pointer-events-auto flex max-w-full touch-none items-center gap-2 px-3 py-2",
              current.tone === "error" && "border-warn/50"
            )}
          >
            <StatusIcon tone={current.tone} />
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-medium text-ink">{current.title}</p>
              {current.detail && (
                <p className="truncate text-[11.5px] text-ink-soft">{current.detail}</p>
              )}
            </div>
            {current.retry && (
              <button
                type="button"
                onClick={() => {
                  setVisible(false);
                  void retrySync();
                }}
                className="press-none ml-1 flex h-9 shrink-0 items-center gap-1 rounded-full bg-accent px-3 text-[12.5px] font-semibold text-accent-ink"
              >
                <RotateCw className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
                Retry
              </button>
            )}
            {/* Dismissible whether or not it would have faded on its own: the
                one thing you can't do with a pill sitting over your list is
                nothing. */}
            {!current.retry && (
              <button
                type="button"
                onClick={() => setVisible(false)}
                aria-label="Dismiss"
                className="press-none ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-faint active:bg-surface-sunken"
              >
                <span aria-hidden className="text-[15px] leading-none">
                  ×
                </span>
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusIcon({ tone }: { tone: SaveStatusView["tone"] }) {
  const className = "h-4 w-4 shrink-0";
  if (tone === "error") {
    return <TriangleAlert className={cn(className, "text-warn")} strokeWidth={2} aria-hidden />;
  }
  if (tone === "pending") {
    return <CloudOff className={cn(className, "text-ink-soft")} strokeWidth={2} aria-hidden />;
  }
  return <Check className={cn(className, "text-good")} strokeWidth={2.5} aria-hidden />;
}

/**
 * Content edits made on this device, this session.
 *
 * The store publishes this (see `subscribeLocalWrites`) rather than the pill
 * inferring it from object identity: a background feed re-sync, a cloud merge,
 * the rehydration repair and every settings toggle all change the store, and
 * none of them is something the person did and might be wondering about.
 */
function useWriteTick(): number {
  return useSyncExternalStore(subscribeLocalWrites, getLocalWriteCount, getServerLocalWriteCount);
}
