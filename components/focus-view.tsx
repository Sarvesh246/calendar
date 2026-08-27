"use client";

import { format } from "date-fns";
import { Check, X } from "lucide-react";
import { useDatebookStore, useCategory } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { formatTime, relativeDueLabel } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

export function FocusView() {
  const toggleFocusMode = useUIStore((s) => s.toggleFocusMode);
  const items = useDatebookStore((s) => s.items);
  const cycleItemStatus = useDatebookStore((s) => s.cycleItemStatus);
  const clock24h = useDatebookStore((s) => s.settings.clock24h);

  const now = new Date();
  const upcoming = [...items]
    .filter((i) => i.status !== "done")
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const current = upcoming[0];
  const next = upcoming[1];
  const currentCategory = useCategory(current?.categoryId);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-8 text-center">
      <button
        onClick={toggleFocusMode}
        aria-label="Exit focus"
        className="fixed right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-ink-faint transition-colors hover:text-ink"
      >
        <X className="h-4 w-4" />
      </button>

      {current ? (
        <>
          <div>
            {currentCategory && (
              <p className="cat-text text-[12px] font-medium uppercase tracking-wider" style={{ "--cat": currentCategory.color } as React.CSSProperties}>
                {currentCategory.name}
              </p>
            )}
            <h1 className="font-display mt-2 max-w-[26ch] text-[36px] italic leading-tight text-ink">
              {current.title}
            </h1>
            <p className="mt-2 text-[15px] text-ink-soft">
              {current.type === "event" ? formatTime(current.at, clock24h) : relativeDueLabel(current.at)}
            </p>
          </div>

          {current.type !== "event" && (
            <button
              onClick={() => cycleItemStatus(current.id)}
              className="flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[13.5px] font-medium text-accent-ink transition-opacity hover:opacity-90"
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
    </div>
  );
}
