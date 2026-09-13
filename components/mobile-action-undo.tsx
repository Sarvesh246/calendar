"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { DismissibleSnack, SnackDismissButton } from "@/components/dismissible-snack";
import { useActionUndo } from "@/lib/action-undo";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";

const UNDO_WINDOW_MS = 8000;

/**
 * Undo for any reversible edit — a move, a status change, a batch edit, a
 * duplicate. Same shape and timing as the delete toast so the two read as one
 * system. Flick it down or tap × to clear it without undoing.
 */
export function MobileActionUndo() {
  const action = useActionUndo((s) => s.action);
  const set = useActionUndo((s) => s.set);

  useEffect(() => {
    if (!action) return;
    const timer = window.setTimeout(() => {
      if (useActionUndo.getState().action === action) set(null);
    }, UNDO_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [action, set]);

  return (
    <AnimatePresence>
      {action && (
        <DismissibleSnack
          key={action.stamp}
          role="status"
          initial={{ opacity: 0, y: 16, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.96 }}
          transition={motionTokens.spring}
          onDismiss={() => set(null)}
          className="pointer-events-auto relative flex w-full max-w-[420px] items-center gap-3 overflow-hidden rounded-xl border border-line bg-surface py-2.5 pl-3.5 pr-1.5 text-[13px] text-ink"
        >
          <Check className="h-3.5 w-3.5 shrink-0 text-good" strokeWidth={2.5} />
          <span className="min-w-0 flex-1 truncate">{action.label}</span>
          <button
            type="button"
            onClick={() => {
              haptic("success");
              set(null);
              action.undo();
            }}
            className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2.5 font-medium text-accent transition-colors hover:bg-accent-soft md:min-h-9"
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
            Undo
          </button>
          <SnackDismissButton onClick={() => set(null)} />
          <span
            aria-hidden
            className="toast-drain absolute inset-x-0 bottom-0 h-[2px] origin-left bg-accent/50"
            style={{ animationDuration: `${UNDO_WINDOW_MS}ms` }}
          />
        </DismissibleSnack>
      )}
    </AnimatePresence>
  );
}
