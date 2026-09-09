"use client";

import { UndoToast } from "./undo-toast";
import { SyncNoticeToasts } from "./sync-notice-toast";

/**
 * One column, just above the tab bar (desktop: bottom of the pane). Sync
 * notices sit on top of the undo pill so they never overlap or float halfway
 * up the screen.
 */
export function ToastViewport() {
  return (
    <div className="viewport-pinned-bottom pointer-events-none fixed inset-x-0 bottom-[calc(var(--safe-bottom)+var(--tab-bar-rest)+5.75rem)] z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
      <SyncNoticeToasts />
      <UndoToast />
    </div>
  );
}
