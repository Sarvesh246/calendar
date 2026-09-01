"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useDatebookStore } from "@/lib/store";
import { motion as motionTokens } from "@/lib/motion";

export function MergeCloudDialog() {
  const offer = useDatebookStore((s) => s.mergeOffer);
  const resolve = useDatebookStore((s) => s.resolveCloudMerge);

  // A plain fixed layer rather than `ViewportLayer`: this dialog has no text
  // field to keep clear of the on-screen keyboard, and `ViewportLayer` drives
  // its position with its own ref/effect that has proven unreliable under
  // `AnimatePresence` elsewhere in the app (see the AI drawer's note on this).
  // A bare positioned div lets the exit animation below actually play instead
  // of the whole subtree disappearing outright.
  return (
    <AnimatePresence>
      {offer && (
        <div className="fixed inset-0 z-[60]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: motionTokens.exit, ease: motionTokens.easeIn } }}
            transition={{ duration: motionTokens.standard }}
            className="overlay-scrim absolute inset-0"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            // This dialog interrupts you at sign-in with an irreversible choice, so
            // it should arrive with some weight rather than simply blink into place —
            // and now leave with the same, instead of vanishing outright once a
            // choice is made.
            initial={{ opacity: 0, scale: 0.94, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{
              opacity: 0,
              scale: 0.96,
              y: 6,
              transition: { duration: motionTokens.exit, ease: motionTokens.easeIn },
            }}
            transition={motionTokens.springGentle}
            className="bg-surface border border-line absolute left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-xl p-5"
          >
            <h2 className="text-[16px] font-semibold text-ink">This device has a different calendar</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
              Cloud has {offer.cloudItems} item{offer.cloudItems === 1 ? "" : "s"}. This device has{" "}
              {offer.localItems}. Last write wins after you choose — merge keeps both and prefers this
              device when ids match.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void resolve("merge")}
                className="min-h-11 rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-ink"
              >
                Merge both
              </button>
              <button
                type="button"
                onClick={() => void resolve("cloud")}
                className="min-h-11 rounded-lg border border-line px-3 text-[13px] font-medium text-ink-soft hover:text-ink"
              >
                Use cloud (discard this device)
              </button>
              <button
                type="button"
                onClick={() => void resolve("local")}
                className="min-h-11 rounded-lg border border-line px-3 text-[13px] font-medium text-ink-soft hover:text-ink"
              >
                Use this device (overwrite cloud)
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
