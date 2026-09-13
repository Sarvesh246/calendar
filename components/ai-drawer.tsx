"use client";

import { useEffect, useRef, useState } from "react";
import { useUIStore } from "@/lib/ui-store";
import { useAssistantDockable } from "@/lib/assistant-dock";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { cn } from "@/lib/utils";
import { AssistantConversation } from "@/components/assistant-conversation";

/**
 * The assistant as a sheet over the page (phone) or a tall column over it
 * (desktop). On a wide calendar it docks into the side pane instead — the
 * calendar page takes the open request, and this stays out of the way.
 */
export function AIDrawer() {
  const requested = useUIStore((s) => s.aiDrawerOpen);
  const setOpen = useUIStore((s) => s.setAIDrawerOpen);
  const dockable = useAssistantDockable();
  const open = requested && !dockable;

  // Keep the sheet mounted through its exit animation, then drop it. The enter/
  // exit visuals are pure CSS keyframes (see globals.css) — framer's
  // AnimatePresence has been unreliable here and an invisible-but-mounted drawer
  // is worse than a plain one.
  const [present, setPresent] = useState(open);
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(panelRef, open && present);
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPresent(true);
      return;
    }
    const t = setTimeout(() => setPresent(false), 190);
    return () => clearTimeout(t);
  }, [open]);

  useLockBodyScroll(present && open);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!present) return null;

  return (
    <div className="viewport-pinned-overlay fixed inset-0 z-50">
      <div
        onClick={() => setOpen(false)}
        className={cn("assistant-overlay overlay-scrim absolute inset-0", open ? "is-open" : "is-closed")}
      />
      <div
        role="dialog"
        ref={panelRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="assistant-title"
        className={cn(
          "assistant-panel absolute flex flex-col overflow-hidden border border-line bg-surface",
          "max-md:inset-x-3 max-md:bottom-[max(0.9rem,calc(var(--keyboard-inset,0px)+env(safe-area-inset-bottom)+0.65rem))] max-md:mx-auto max-md:h-[70dvh] max-md:max-h-[min(560px,calc(100%-env(safe-area-inset-top)-1.25rem-var(--keyboard-inset,0px)))] max-md:w-auto max-md:max-w-[400px] max-md:rounded-[22px] max-md:shadow-[0_16px_40px_-12px_rgb(0_0_0_/_0.28)]",
          open ? "is-open" : "is-closed"
        )}
      >
        <AssistantConversation variant="modal" active={open && present} onClose={() => setOpen(false)} />
      </div>
    </div>
  );
}
