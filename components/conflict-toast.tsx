"use client";

import { useDatebookStore } from "@/lib/store";

export function ConflictToast() {
  const lastConflict = useDatebookStore((s) => s.lastConflict);
  const clear = useDatebookStore((s) => s.clearConflict);
  if (!lastConflict) return null;

  return (
    <div className="pointer-events-auto fixed bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] left-1/2 z-40 w-[calc(100%-2rem)] max-w-[420px] -translate-x-1/2 rounded-xl border border-line bg-surface px-3.5 py-3 md:bottom-6">
      <p className="text-[13px] text-ink">
        Another device updated <span className="font-medium">{lastConflict}</span>. Showing the latest cloud version.
      </p>
      <button
        type="button"
        onClick={clear}
        className="mt-2 text-[12.5px] font-medium text-ink-soft hover:text-ink"
      >
        Dismiss
      </button>
    </div>
  );
}
