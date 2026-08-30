"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";
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

  // Focus mode hides the nav, so Esc is the keyboard way back out.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") toggleFocusMode();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFocusMode]);

  const { current, next } = focusQueue(items);
  const currentCategory = useCategory(current?.categoryId);

  return (
    // Entering focus mode strips away the whole shell, so the one thing left
    // should arrive rather than simply be there — otherwise the transition reads
    // as the app having crashed into a blank page.
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
          <motion.div key={current.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={motionTokens.springGentle}>
            {currentCategory && (
              <p className="cat-text text-[12px] font-medium uppercase tracking-wider" style={{ "--cat": currentCategory.color } as React.CSSProperties}>
                {currentCategory.name}
              </p>
            )}
            <h1 className="font-display mt-2 max-w-[26ch] text-[32px] italic leading-tight text-ink sm:text-[36px]">
              {current.title}
            </h1>
            <p className="mt-2 text-[15px] text-ink-soft">
              {current.type === "event" ? formatTime(current.at, clock24h) : relativeDueLabel(current.at, { allDay: current.allDay })}
            </p>
          </motion.div>

          {current.type !== "event" && (
            <button
              onClick={() => {
                haptic("success");
                setItemStatus(current.id, "done");
              }}
              className="flex min-h-12 items-center gap-2 rounded-full bg-accent px-6 py-3 text-[14px] font-medium text-accent-ink shadow-[var(--shadow-md)] transition-[opacity,box-shadow] duration-[var(--motion-standard)] hover:opacity-90 hover:shadow-[var(--shadow-lg)]"
            >
              <Check className="h-4 w-4" strokeWidth={2.5} />
              Mark complete
            </button>
          )}

          {next && (
            <div className="mt-4 border-t border-line pt-6">
              <p className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">Up next</p>
              <p className="mt-1.5 text-[14px] text-ink-soft">
                {next.title} · {format(new Date(next.at), "EEE, MMM d")}
              </p>
            </div>
          )}
        </>
      ) : (
        <p className="font-display text-[28px] italic text-ink-soft">Nothing left. Enjoy it.</p>
      )}
    </motion.div>
  );
}
