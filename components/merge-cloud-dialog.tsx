"use client";

import { motion } from "framer-motion";
import { useDatebookStore } from "@/lib/store";
import { ViewportLayer } from "@/components/viewport-layer";
import { motion as motionTokens } from "@/lib/motion";

export function MergeCloudDialog() {
  const offer = useDatebookStore((s) => s.mergeOffer);
  const resolve = useDatebookStore((s) => s.resolveCloudMerge);
  if (!offer) return null;

  return (
    <ViewportLayer className="z-[60]">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: motionTokens.standard }}
        className="overlay-scrim absolute inset-0"
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        // This dialog interrupts you at sign-in with an irreversible choice, so
        // it should arrive with some weight rather than simply blink into place.
        initial={{ opacity: 0, scale: 0.94, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={motionTokens.springGentle}
        className="glass absolute left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-xl p-5"
      >
        <h2 className="text-[16px] font-semibold text-ink">This device has a different calendar</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
          Cloud has {offer.cloudItems} item{offer.cloudItems === 1 ? "" : "s"}. This device has {offer.localItems}. Last
          write wins after you choose — merge keeps both and prefers this device when ids match.
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
    </ViewportLayer>
  );
}
