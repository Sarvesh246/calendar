"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { Check, X } from "lucide-react";
import { useDatebookStore, useCategory } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { focusQueue, formatTime, relativeDueLabel } from "@/lib/date-utils";
import { applyItemFilters } from "@/lib/filters";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";

export function FocusView() {
  const toggleFocusMode = useUIStore((s) => s.toggleFocusMode);
  const items = applyItemFilters(useDatebookStore((s) => s.items), {
    categoryFilter: useUIStore((s) => s.categoryFilter),
    hideCompleted: useDatebookStore((s) => s.settings.hideCompleted),
  });
  const setItemStatus = useDatebookStore((s) => s.setItemStatus);
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const [celebrating, setCelebrating] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") toggleFocusMode();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFocusMode]);

  const { current, next } = focusQueue(items);
  const currentCategory = useCategory(current?.categoryId);

  function completeCurrent() {
    if (!current || current.type === "event" || celebrating) return;
    haptic("success");
    setCelebrating(true);
    window.setTimeout(() => {
      setItemStatus(current.id, "done");
      setCelebrating(false);
    }, 320);
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={motionTokens.springGentle}
      className="flex min-h-[70vh] flex-col items-center justify-center gap-8 text-center"
    >
      <button
        onClick={toggleFocusMode}
        aria-label="Exit focus"
        className="fixed right-4 top-[calc(env(safe-area-inset-top)+0.75rem)] z-50 flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink-soft shadow-[var(--shadow-md)] transition-colors hover:border-line-strong hover:text-ink"
      >
        <X className="h-4 w-4" strokeWidth={2} />
        Exit focus
      </button>

      {current ? (
        <>
          <motion.div
            key={current.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: celebrating ? 0.85 : 1, y: 0, scale: celebrating ? 0.98 : 1 }}
            transition={motionTokens.springGentle}
          >
            {currentCategory && (
              <p
                className="cat-text text-[12px] font-medium uppercase tracking-wider"
                style={{ "--cat": currentCategory.color } as React.CSSProperties}
              >
                {currentCategory.name}
              </p>
            )}
            <h1 className="font-display mt-2 max-w-[26ch] text-[32px] italic leading-tight text-ink sm:text-[36px]">
              {current.title}
            </h1>
            <p className="mt-2 text-[15px] text-ink-soft">
              {current.type === "event"
                ? formatTime(current.at, clock24h)
                : relativeDueLabel(current.at, { allDay: current.allDay })}
            </p>
            <AnimatePresence>
              {celebrating && (
                <motion.span
                  key="celebrate"
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1.4, opacity: 0 }}
                  transition={{ duration: 0.32, ease: motionTokens.ease }}
                  className="complete-ripple pointer-events-none mx-auto mt-4 block h-12 w-12 rounded-full border-2 border-good"
                />
              )}
            </AnimatePresence>
          </motion.div>

          {current.type !== "event" && (
            <button
              onClick={completeCurrent}
              disabled={celebrating}
              className="flex min-h-12 items-center gap-2 rounded-full bg-accent px-6 py-3 text-[14px] font-medium text-accent-ink shadow-[var(--shadow-md)] transition-[opacity,box-shadow] duration-[var(--motion-standard)] hover:opacity-90 hover:shadow-[var(--shadow-lg)] disabled:opacity-60"
            >
              <Check className="h-4 w-4" strokeWidth={2.5} />
              Mark complete
            </button>
          )}

          {next && (
            <p className="text-[13px] text-ink-faint">
              Up next · {next.title}
              {next.type !== "event" && ` · ${format(new Date(next.at), "MMM d")}`}
            </p>
          )}
        </>
      ) : (
        <p className="font-display text-[28px] italic text-ink-soft">Nothing left. Enjoy it.</p>
      )}
    </motion.div>
  );
}
