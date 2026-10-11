"use client";

import { useEffect, useRef, useState } from "react";
import { animate, motion, useDragControls, useMotionValue, useTransform } from "framer-motion";
import { haptic } from "@/lib/haptic";
import { releaseSpring } from "@/lib/motion";
import { sheetRelease } from "@/lib/sheet-gesture";
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
  // On a phone the assistant is a sheet, so it has a sheet's manners: grab
  // the top edge and it follows the finger, flick it down and it leaves at
  // that speed, let go short and it springs home. The veil follows it.
  const dragControls = useDragControls();
  const y = useMotionValue(0);
  const veil = useTransform(y, (v) => {
    const h = panelRef.current?.offsetHeight || 1;
    return Math.max(0, Math.min(1, 1 - v / h));
  });
  const [seenOpen, setSeenOpen] = useState(open);
  if (seenOpen !== open) {
    setSeenOpen(open);
    // A fresh open starts from the resting position, whatever the last
    // dismissal left behind.
    if (open) y.set(0);
  }
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

  useLockBodyScroll(present);

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
    // Lets go of the page the moment it starts closing: taps reach the app
    // during the exit instead of landing on a veil that is on its way out.
    <div className={cn("viewport-pinned-overlay fixed inset-0 z-50", !open && "pointer-events-none")}>
      <motion.div
        // On press, like every other sheet's veil.
        onPointerDown={() => setOpen(false)}
        style={{ opacity: veil }}
        className={cn("assistant-overlay overlay-scrim absolute inset-0", open ? "is-open" : "is-closed")}
      />
      <motion.div
        role="dialog"
        ref={panelRef}
        style={{ y }}
        drag={phone ? "y" : false}
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.1, bottom: 1 }}
        dragMomentum={false}
        onDragEnd={(_, info) => {
          const h = panelRef.current?.offsetHeight ?? 500;
          const release = sheetRelease({ at: y.get(), velocity: info.velocity.y, height: h, points: [0] });
          if (release.kind === "close") {
            haptic("light");
            void animate(y, h + 40, { ...releaseSpring(Math.max(0, info.velocity.y), 1, 0.34), restDelta: 2 }).then(
              () => setOpen(false)
            );
            return;
          }
          void animate(y, 0, releaseSpring(info.velocity.y, 0.86, 0.4));
        }}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="assistant-title"
        className={cn(
          "assistant-panel absolute flex flex-col overflow-hidden border border-line bg-surface",
          "max-md:transition-[bottom] max-md:duration-[280ms] max-md:ease-[var(--ease-standard)]",
          "max-md:inset-x-3 max-md:bottom-[max(0.9rem,calc(var(--keyboard-inset,0px)+env(safe-area-inset-bottom)+0.65rem))] max-md:mx-auto max-md:h-[70dvh] max-md:max-h-[min(560px,calc(100%-env(safe-area-inset-top)-1.25rem-var(--keyboard-inset,0px)))] max-md:w-auto max-md:max-w-[400px] max-md:rounded-[22px] max-md:shadow-[0_16px_40px_-12px_rgb(0_0_0_/_0.28)]",
          open ? "is-open" : "is-closed"
        )}
      >
        {phone && (
          <div
            aria-hidden
            onPointerDown={(e) => dragControls.start(e)}
            className="absolute left-1/2 top-0 z-10 flex h-5 w-24 -translate-x-1/2 cursor-grab touch-none justify-center pt-1.5 active:cursor-grabbing"
          >
            <span className="h-1 w-9 rounded-full bg-line-strong opacity-70" />
          </div>
        )}
        <AssistantConversation variant="modal" active={open && present} onClose={() => setOpen(false)} />
      </motion.div>
    </div>
  );
}
