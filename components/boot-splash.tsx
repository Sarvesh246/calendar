"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { motion } from "framer-motion";
import { useDatebookStore } from "@/lib/store";
import { motion as motionTokens, prefersReducedMotion } from "@/lib/motion";

function subscribeHydration(onStoreChange: () => void) {
  return useDatebookStore.persist.onFinishHydration(onStoreChange);
}

function persistHydrated() {
  return useDatebookStore.persist.hasHydrated();
}

const MIN_MS = 420;
const EXIT_MS = 480;

/**
 * Cold-start veil. Covers the first paint so the store can hydrate and the
 * landing tab can mount without a pulsing logo standing in for the app.
 *
 * It lives in the shell, so a client-side tab change never replays it. A
 * refresh does — that's a real launch again.
 */
export function BootSplash() {
  const hydrated = useSyncExternalStore(subscribeHydration, persistHydrated, () => false);
  const reduced = prefersReducedMotion();
  const [phase, setPhase] = useState<"cover" | "out" | "gone">("cover");
  const started = useRef(typeof performance === "undefined" ? 0 : performance.now());

  useEffect(() => {
    if (!hydrated || phase !== "cover") return;
    const wait = Math.max(0, MIN_MS - (performance.now() - started.current));
    const t = window.setTimeout(() => {
      document.documentElement.removeAttribute("data-first-load");
      setPhase("out");
    }, wait);
    return () => window.clearTimeout(t);
  }, [hydrated, phase]);

  useEffect(() => {
    if (phase !== "out") return;
    const t = window.setTimeout(() => setPhase("gone"), reduced ? 160 : EXIT_MS);
    return () => window.clearTimeout(t);
  }, [phase, reduced]);

  if (phase === "gone") return null;

  const leaving = phase === "out";

  return (
    <motion.div
      role="status"
      aria-live="polite"
      aria-label="Opening Datebook"
      initial={false}
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={
        reduced
          ? { duration: motionTokens.micro }
          : leaving
            ? { duration: EXIT_MS / 1000, ease: [0.22, 1, 0.36, 1] }
            : { duration: 0.18 }
      }
      className="boot-splash fixed inset-0 z-[120] flex items-center justify-center"
    >
      <span className="sr-only">Opening Datebook</span>
      <motion.div
        initial={reduced ? false : { opacity: 0, scale: 0.78 }}
        animate={
          leaving
            ? reduced
              ? { opacity: 0 }
              : { opacity: 0, scale: 1.08, y: -10, filter: "blur(8px)" }
            : { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }
        }
        transition={
          reduced
            ? { duration: motionTokens.standard }
            : leaving
              ? { duration: 0.42, ease: [0.22, 1, 0.36, 1] }
              : { type: "spring", stiffness: 280, damping: 22, mass: 0.9 }
        }
        className="relative flex flex-col items-center"
      >
          <span aria-hidden className="boot-splash-bloom" />
          <span className="boot-splash-plate relative flex h-[96px] w-[96px] items-center justify-center rounded-[26px]">
            <img
              src="/icon-192.png"
              alt=""
              width={80}
              height={80}
              className="boot-splash-mark h-20 w-20 rounded-[20px]"
            />
          </span>
        <motion.p
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={leaving ? { opacity: 0, y: -4 } : { opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: leaving ? 0 : 0.12, ease: motionTokens.ease }}
          className="mt-4 text-[15px] font-medium tracking-[0.04em] text-ink-soft"
        >
          Datebook
        </motion.p>
      </motion.div>
    </motion.div>
  );
}
