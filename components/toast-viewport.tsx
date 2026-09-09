"use client";

import { UndoToast } from "./undo-toast";
import { SyncNoticeToasts } from "./sync-notice-toast";

/**
 * Sync notices peek just under the floating header cluster (iOS banner),
 * never over the tab bar or the plus button. Undo stays a snackbar above
 * the nav — a local action belongs next to the hand that did it.
 */
export function ToastViewport() {
  return (
    <>
      <div className="viewport-pinned-top pointer-events-none fixed inset-x-3 top-[calc(var(--mobile-header-height)+0.35rem)] z-[60] flex flex-col items-center gap-2 md:inset-x-auto md:left-[calc(220px+1.75rem)] md:right-6 md:top-[4.85rem]">
        <SyncNoticeToasts />
      </div>
      <div className="viewport-pinned-bottom pointer-events-none fixed inset-x-0 bottom-[calc(var(--safe-bottom)+var(--tab-bar-rest)+5.75rem)] z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
        <UndoToast />
      </div>
    </>
  );
}
