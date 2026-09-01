"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Minimize2, MoreHorizontal } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { motion as motionTokens } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ViewMenu({ showFocus = false }: { showFocus?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const hideCompleted = useDatebookStore((s) => s.settings.hideCompleted);
  const updateSettings = useDatebookStore((s) => s.updateSettings);
  const toggleFocusMode = useUIStore((s) => s.toggleFocusMode);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <Button
        variant="tertiary"
        size="iconSm"
        aria-label="View options"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={1.9} />
      </Button>
      {/* This popped open and shut with no transition at all — the sharpest
          menu in the app. It now scales in from its anchor corner on the same
          snappy spring as every other small popover. */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{
              opacity: 0,
              scale: 0.96,
              y: -2,
              transition: { duration: motionTokens.exit, ease: motionTokens.easeIn },
            }}
            transition={motionTokens.springSnappy}
            style={{ transformOrigin: "top right" }}
            className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[200px] rounded-xl border border-line bg-surface p-1"
          >
            <button
              type="button"
              onClick={() => {
                updateSettings({ hideCompleted: !hideCompleted });
                setOpen(false);
              }}
              className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-2.5 text-left text-[13px] text-ink transition-colors duration-[var(--motion-micro)] hover:bg-surface-sunken"
            >
              Hide completed
              {hideCompleted && <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.5} />}
            </button>
            {showFocus && (
              <button
                type="button"
                onClick={() => {
                  toggleFocusMode();
                  setOpen(false);
                }}
                className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-ink transition-colors duration-[var(--motion-micro)] hover:bg-surface-sunken"
              >
                <Minimize2 className="h-3.5 w-3.5 text-ink-faint" strokeWidth={1.9} />
                Focus
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ViewMenuRow({ className, showFocus }: { className?: string; showFocus?: boolean }) {
  return (
    <div className={cn("flex shrink-0 items-center", className)}>
      <ViewMenu showFocus={showFocus} />
    </div>
  );
}
