"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { startSheetDrag } from "@/lib/sheet-gesture";
import { useSheetPhysics } from "@/lib/use-sheet-physics";
import { Scrim } from "@/components/ui/scrim";
import { useMediaQuery } from "@/lib/use-media-query";
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
  const phone = useMediaQuery("(max-width: 767px)");
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

  useLockBodyScroll(present && !phone);

  useEffect(() => {
    // The phone sheet owns its own Escape so it can leave with its physics.
    if (!open || phone) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, phone, setOpen]);

  // Phone: a full-height room pinned to the visible band, with the same
  // sheet physics as every other sheet. It owns its exit, so it is mounted
  // only while open and is never wrapped in AnimatePresence.
  if (phone) {
    return open ? <PhoneAssistantSheet onClosed={() => setOpen(false)} /> : null;
  }

  if (!present) return null;

  return (
    // Lets go of the page the moment it starts closing: taps reach the app
    // during the exit instead of landing on a veil that is on its way out.
    <div
      className={cn("viewport-pinned-overlay fixed inset-0 z-50", !open && "pointer-events-none")}
    >
      <div
        // On press, like every other sheet's veil.
        onPointerDown={() => setOpen(false)}
        className={cn(
          "assistant-overlay overlay-scrim absolute inset-0",
          open ? "is-open" : "is-closed",
        )}
      />
      <div
        role="dialog"
        ref={panelRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="assistant-title"
        className={cn(
          "assistant-panel absolute flex flex-col overflow-hidden border border-line bg-surface",
          open ? "is-open" : "is-closed",
        )}
      >
        <AssistantConversation
          variant="modal"
          active={open && present}
          onClose={() => setOpen(false)}
        />
      </div>
    </div>
  );
}

/**
 * The assistant on a phone: a sheet pinned to the band the user can see —
 * `top: --viewport-pan`, `height: --visible-height`, both published by
 * `useKeyboardInset`. The conversation is a flex column (header, thread,
 * composer), so with the sheet equal to the visible band the composer is the
 * last thing in it and cannot be covered, and the header cannot leave the top,
 * whatever the keyboard or the pan is doing. No `bottom` transition: the sheet
 * does not chase the keyboard, it is the keyboard's complement.
 */
function PhoneAssistantSheet({ onClosed }: { onClosed: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const sheet = useSheetPhysics({ panelRef, onClosed });
  const { close, dragControls, dragProps } = sheet;
  useLockBodyScroll(true);
  useDialogFocus(panelRef, true);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <div
      className={cn(
        "viewport-pinned-overlay fixed inset-0 z-50",
        sheet.leaving && "pointer-events-none",
      )}
    >
      <Scrim onPointerDown={() => close()} progress={sheet.scrimOpacity} exitDuration={0} />
      <motion.div
        role="dialog"
        ref={panelRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="assistant-title"
        {...dragProps}
        style={{
          ...dragProps.style,
          top: "var(--viewport-pan, 0px)",
          height: "var(--visible-height, 100dvh)",
        }}
        className="assistant-room absolute inset-x-0 flex flex-col overflow-hidden rounded-t-[22px] border border-b-0 border-line bg-surface pt-[env(safe-area-inset-top)] shadow-[0_-12px_40px_-12px_rgb(0_0_0_/_0.28)]"
      >
        <div
          aria-hidden
          onPointerDown={(e) => startSheetDrag(dragControls, e)}
          className="absolute left-1/2 top-[env(safe-area-inset-top)] z-10 flex h-5 w-24 -translate-x-1/2 cursor-grab touch-none justify-center pt-1.5 active:cursor-grabbing"
        >
          <span className="h-1 w-9 rounded-full bg-line-strong opacity-70" />
        </div>
        <AssistantConversation variant="modal" active onClose={() => close()} />
      </motion.div>
    </div>
  );
}
