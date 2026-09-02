"use client";

import { motion } from "framer-motion";
import { CalendarDays, Check, MapPin, Sparkles } from "lucide-react";
import { format, isSameDay } from "date-fns";
import { Button } from "@/components/ui/button";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { BulkDraft } from "@/lib/bulk-parse";

function whenLabel(draft: BulkDraft): string {
  const start = format(draft.at, "EEE, MMM d");
  if (!draft.endAt || isSameDay(draft.at, draft.endAt)) return start;
  return `${start} – ${format(draft.endAt, "MMM d")}`;
}

/** The multi-item confirmation for a pasted schedule. Everything is opt-out:
 *  the rows are pre-selected, so the common case is one more click. */
export function BulkAddPreview({
  drafts,
  skipped,
  selected,
  onToggle,
  onCancel,
  onConfirm,
  onAskAI,
}: {
  drafts: BulkDraft[];
  skipped: string[];
  selected: boolean[];
  onToggle: (index: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onAskAI: () => void;
}) {
  const count = selected.filter(Boolean).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{
        opacity: 0,
        y: -6,
        scale: 0.98,
        transition: { duration: motionTokens.exit, ease: motionTokens.easeIn },
      }}
      transition={motionTokens.spring}
      style={{ transformOrigin: "top center" }}
      className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 flex max-h-[min(60dvh,calc(var(--visible-height,100dvh)-8rem))] flex-col rounded-lg border border-line bg-surface"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line/60 px-4 py-3">
        <p className="text-[13.5px] font-semibold text-ink">
          {drafts.length} item{drafts.length === 1 ? "" : "s"} found
        </p>
        <p className="text-[12px] text-ink-faint">Uncheck anything you don&apos;t want</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-2 py-2">
        {drafts.map((draft, i) => (
          <button
            key={`${draft.source}-${i}`}
            type="button"
            onClick={() => onToggle(i)}
            aria-pressed={selected[i]}
            className={cn(
              "flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
              "hover:bg-surface-sunken/70",
              !selected[i] && "opacity-45"
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border transition-colors",
                selected[i] ? "border-accent bg-accent text-accent-ink" : "border-line-strong"
              )}
            >
              {selected[i] && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium text-ink">
                {draft.title}
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-ink-soft">
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" strokeWidth={1.9} />
                  {whenLabel(draft)}
                </span>
                {draft.location && (
                  <span className="flex min-w-0 items-center gap-1">
                    <MapPin className="h-3 w-3 shrink-0" strokeWidth={1.9} />
                    <span className="truncate">{draft.location}</span>
                  </span>
                )}
              </span>
            </span>
          </button>
        ))}

        {skipped.length > 0 && (
          <p className="px-2 py-2 text-[12px] leading-relaxed text-ink-faint">
            {skipped.length} line{skipped.length === 1 ? "" : "s"} had no date we could read.
            The assistant can usually work them out.
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line/60 px-4 py-3">
        <Button variant="tertiary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="secondary" size="sm" onClick={onAskAI}>
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
          Ask assistant
        </Button>
        <Button variant="primary" size="sm" onClick={onConfirm} disabled={count === 0}>
          Add {count} item{count === 1 ? "" : "s"}
        </Button>
      </div>
    </motion.div>
  );
}
