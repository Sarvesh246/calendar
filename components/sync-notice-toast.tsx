"use client";

import { useEffect, useRef } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useTransform,
} from "framer-motion";
import { Cloud, X } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { project } from "@/lib/gesture";
import { releaseSpring, motion as motionTokens, prefersReducedMotion } from "@/lib/motion";
import { haptic } from "@/lib/haptic";
import type { SyncNotice } from "@/lib/sync-notice";
import { cn } from "@/lib/utils";

const AUTO_MS: Record<SyncNotice["kind"], number> = {
  remote: 5200,
  conflict: 6800,
  bulk: 5200,
};

function copyFor(n: SyncNotice): { title: string; detail: string } {
  if (n.kind === "bulk") {
    return { title: "Calendar updated", detail: "Several items changed on another device" };
  }
  if (n.kind === "conflict") {
    return {
      title: n.title,
      detail: "Updated on another device while you were editing",
    };
  }
  return { title: n.title, detail: "Updated on another device" };
}

export function SyncNoticeToasts() {
  const notices = useDatebookStore((s) => s.syncNotices);
  const dismiss = useDatebookStore((s) => s.dismissSyncNotice);

  if (notices.length === 0) return null;

  return (
    <div className="flex w-full max-w-[420px] flex-col items-stretch gap-2 self-center">
      <AnimatePresence initial={false}>
        {notices.map((notice) => (
          <SwipeNotice
            key={notice.id}
            notice={notice}
            onDismiss={() => dismiss(notice.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

function SwipeNotice({
  notice,
  onDismiss,
}: {
  notice: SyncNotice;
  onDismiss: () => void;
}) {
  const reduced = prefersReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();
  const dragging = useRef(false);
  const dismissed = useRef(false);
  const paused = useRef(false);
  const onDismissRef = useRef(onDismiss);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const opacity = useTransform([x, y], ([xv, yv]) => {
    const d = Math.max(Math.abs(xv as number), Math.abs(yv as number) * 1.15);
    return Math.max(0.15, 1 - d / 150);
  });
  const copy = copyFor(notice);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    dismissed.current = false;
    x.set(0);
    y.set(0);
  }, [notice.id, notice.rev, x, y]);

  useEffect(() => {
    const duration = AUTO_MS[notice.kind];
    let remaining = duration;
    let startedAt = Date.now();
    let timer: number | undefined;

    const play = () => {
      if (dismissed.current) return;
      paused.current = false;
      startedAt = Date.now();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!dragging.current && !paused.current) onDismissRef.current();
      }, remaining);
    };
    const pause = () => {
      if (paused.current) return;
      paused.current = true;
      window.clearTimeout(timer);
      remaining = Math.max(120, remaining - (Date.now() - startedAt));
    };

    play();
    const node = cardRef.current;
    node?.addEventListener("pointerenter", pause);
    node?.addEventListener("pointerleave", play);
    return () => {
      window.clearTimeout(timer);
      node?.removeEventListener("pointerenter", pause);
      node?.removeEventListener("pointerleave", play);
    };
  }, [notice.id, notice.rev, notice.kind]);

  /**
   * Throw the banner off the way the finger was going, at the speed it was
   * going. A fixed ease-in used to restart it from rest at the hand-off, so a
   * flicked banner visibly caught for a frame before it left.
   */
  function flyAway(toX: number, toY: number, vx = 0, vy = 0) {
    if (dismissed.current) return;
    dismissed.current = true;
    haptic("light");
    if (reduced) {
      onDismissRef.current();
      return;
    }
    const away = { restDelta: 2, restSpeed: 60 };
    void Promise.all([
      animate(x, toX, { ...releaseSpring(vx, 1, 0.3), ...away }),
      animate(y, toY, { ...releaseSpring(vy, 1, 0.3), ...away }),
    ]).then(() => onDismissRef.current());
  }

  return (
    <motion.div
      layout
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={
        reduced
          ? { opacity: 0 }
          : {
              opacity: 0,
              y: -12,
              scale: 0.97,
              transition: { duration: motionTokens.exit, ease: motionTokens.easeIn },
            }
      }
      transition={motionTokens.springSnappy}
      className="pointer-events-auto"
    >
      <motion.div
        ref={cardRef}
        style={{ x, y, opacity }}
        drag={reduced ? false : true}
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
        // Free sideways and upward (the ways it can leave), resisting only
        // downward, where there is nowhere for it to go.
        dragElastic={{ left: 1, right: 1, top: 1, bottom: 0.22 }}
        dragMomentum={false}
        dragTransition={{ bounceStiffness: 560, bounceDamping: 38 }}
        onDragStart={() => {
          dragging.current = true;
        }}
        onDragEnd={(_, info) => {
          dragging.current = false;
          const { velocity: v } = info;
          // Judged on where the banner would coast to, not where it is.
          const px = project(x.get(), v.x);
          const py = project(y.get(), v.y);
          if (Math.abs(px) > 90 && Math.abs(px) >= Math.abs(py)) {
            flyAway(Math.sign(px) * 440, y.get() + v.y * 0.1, v.x, v.y);
          } else if (py < -44) {
            flyAway(x.get(), -180, v.x, v.y);
          } else if (py > 110) {
            flyAway(x.get(), 180, v.x, v.y);
          } else {
            void animate(x, 0, releaseSpring(v.x, 0.8, 0.34));
            void animate(y, 0, releaseSpring(v.y, 0.8, 0.34));
          }
        }}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="cursor-grab touch-none select-none will-change-transform active:cursor-grabbing"
      >
        <div
          className={cn(
            "sync-notice-card relative flex w-full items-start gap-2 overflow-hidden pl-3 pr-1.5 py-2"
          )}
        >
          <div
            className="flex min-w-0 flex-1 items-start gap-2.5 py-0.5"
            onPointerDown={(e) => {
              if (reduced) return;
              dragControls.start(e);
            }}
          >
            <span
              aria-hidden
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
            >
              <Cloud className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
            <p className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium leading-tight text-ink">
                {copy.title}
              </span>
              <span className="mt-0.5 block text-[12px] leading-snug text-ink-soft">
                {copy.detail}
              </span>
            </p>
          </div>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              haptic("light");
              onDismissRef.current();
            }}
            aria-label="Dismiss"
            className="relative z-20 mt-0.5 flex h-9 w-9 shrink-0 cursor-pointer touch-auto items-center justify-center rounded-full bg-surface-sunken text-ink-soft transition-colors hover:bg-line hover:text-ink"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.2} />
          </button>
          <span
            aria-hidden
            key={notice.rev}
            className="toast-drain absolute inset-x-0 bottom-0 h-[2px] origin-left bg-accent/40"
            style={{ animationDuration: `${AUTO_MS[notice.kind]}ms` }}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}
