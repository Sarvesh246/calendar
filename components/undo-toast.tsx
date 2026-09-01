"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { RotateCcw, Trash2 } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { motion as motionTokens } from "@/lib/motion";
import { haptic } from "@/lib/haptic";

const UNDO_WINDOW_MS = 8000;

export function UndoToast() {
  const lastDeleted = useDatebookStore((s) => s.lastDeleted);
  const restoreLastDeleted = useDatebookStore((s) => s.restoreLastDeleted);

  useEffect(() => {
    if (!lastDeleted) return;
    const t = window.setTimeout(() => {
      useDatebookStore.setState({ lastDeleted: null });
    }, UNDO_WINDOW_MS);
    return () => window.clearTimeout(t);
  }, [lastDeleted]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-50 flex justify-center px-4 md:bottom-6">
      <AnimatePresence>
        {lastDeleted && (
          <motion.div
            // Keyed on the item so deleting a second thing replays the entrance
            // rather than silently swapping the title inside a static pill.
            key={lastDeleted.id}
            initial={{ opacity: 0, y: 16, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={motionTokens.spring}
            className="pointer-events-auto relative flex max-w-[min(92vw,26rem)] items-center gap-3 overflow-hidden rounded-xl border border-line bg-surface py-2.5 pl-3.5 pr-2 text-[13px] text-ink"
          >
            <Trash2 className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={1.9} />
            <span className="min-w-0 flex-1 truncate">
              Deleted <span className="font-medium">{lastDeleted.title}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                haptic("success");
                restoreLastDeleted();
              }}
              className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 font-medium text-accent transition-colors hover:bg-accent-soft"
            >
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
              Undo
            </button>

            {/* The undo window, drawn. Without it the toast just vanishes and you
                never learn how long you actually had. */}
            <span
              aria-hidden
              className="toast-drain absolute inset-x-0 bottom-0 h-[2px] origin-left bg-accent/50"
              style={{ animationDuration: `${UNDO_WINDOW_MS}ms` }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
