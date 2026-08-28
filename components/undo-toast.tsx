"use client";

import { useEffect } from "react";
import { useDatebookStore } from "@/lib/store";

export function UndoToast() {
  const lastDeleted = useDatebookStore((s) => s.lastDeleted);
  const restoreLastDeleted = useDatebookStore((s) => s.restoreLastDeleted);

  useEffect(() => {
    if (!lastDeleted) return;
    const t = window.setTimeout(() => {
      useDatebookStore.setState({ lastDeleted: null });
    }, 8000);
    return () => window.clearTimeout(t);
  }, [lastDeleted]);

  if (!lastDeleted) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-50 flex justify-center px-4 md:bottom-6">
      <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[13px] text-ink shadow-[var(--shadow-md)]">
        <span className="max-w-[40vw] truncate">Deleted “{lastDeleted.title}”</span>
        <button
          type="button"
          onClick={() => restoreLastDeleted()}
          className="font-medium text-accent"
        >
          Undo
        </button>
      </div>
    </div>
  );
}
