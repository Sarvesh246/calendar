"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { MobileActionUndo } from "./mobile-action-undo";
import { SaveStatusPill } from "./save-status-pill";
import { UndoToast } from "./undo-toast";
import { SyncNoticeToasts } from "./sync-notice-toast";

const subscribeToMount = () => () => {};
const mountedOnClient = () => true;
const mountedOnServer = () => false;

/**
 * Sync notices peek just under the floating header cluster (iOS banner),
 * never over the tab bar or the plus button. Undo stays a snackbar above
 * the nav — a local action belongs next to the hand that did it.
 * Body portals and shell overlays otherwise compete at the same z-index:
 * keep both toast stacks above dialogs (50–70), with the launch veil (120)
 * above everything. Actionable undo remains visible while a sheet is open.
 */
export function ToastViewport() {
  const mounted = useSyncExternalStore(subscribeToMount, mountedOnClient, mountedOnServer);
  if (!mounted) return null;

  return createPortal(
    <>
      <div className="viewport-pinned-top pointer-events-none fixed inset-x-3 top-[calc(var(--mobile-header-height)+0.35rem)] z-[100] flex flex-col items-center gap-2 md:inset-x-auto md:left-[calc(220px+1.75rem)] md:right-6 md:top-[4.85rem]">
        <SyncNoticeToasts />
      </div>
      <div className="viewport-pinned-bottom pointer-events-none fixed inset-x-0 bottom-[calc(var(--safe-bottom)+var(--tab-bar-rest)+5.75rem)] z-[100] flex flex-col items-center gap-2 px-4 transition-[bottom] duration-[var(--motion-standard)] md:bottom-[var(--toast-lift,1.5rem)]">
        <UndoToast />
        <MobileActionUndo />
        {/* Last, so an undo — which expires — is never pushed off the screen
            edge by a save status that may be sitting there indefinitely. */}
        <SaveStatusPill />
      </div>
    </>,
    document.body
  );
}
