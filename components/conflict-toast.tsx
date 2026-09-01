"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CloudDownload, X } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { motion as motionTokens } from "@/lib/motion";

export function ConflictToast() {
  const lastConflict = useDatebookStore((s) => s.lastConflict);
  const clear = useDatebookStore((s) => s.clearConflict);

  return (
    // Stacked above the undo toast rather than on top of it — both used to sit at
    // the same offset, so a delete during a sync conflict rendered one pill
    // directly over the other.
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+9.5rem)] z-50 flex justify-center px-4 md:bottom-[5.5rem]">
      <AnimatePresence>
        {lastConflict && (
          <motion.div
            key={lastConflict}
            initial={{ opacity: 0, y: 16, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={motionTokens.spring}
            role="status"
            className="pointer-events-auto flex w-full max-w-[420px] items-start gap-2.5 rounded-xl border border-line bg-surface px-3.5 py-3"
          >
            <CloudDownload className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" strokeWidth={1.9} />
            <p className="min-w-0 flex-1 text-[13px] leading-snug text-ink">
              Another device updated <span className="font-medium">{lastConflict}</span>. Showing the
              latest cloud version.
            </p>
            <button
              type="button"
              onClick={clear}
              aria-label="Dismiss"
              className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
