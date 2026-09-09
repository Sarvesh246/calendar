"use client";

import { useEffect, useRef } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useTransform,
} from "framer-motion";
import { Cloud, X } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { motion as motionTokens, prefersReducedMotion } from "@/lib/motion";
import { haptic } from "@/lib/haptic";
import type { SyncNotice } from "@/lib/sync-notice";
import { cn } from "@/lib/utils";

const AUTO_MS: Record<SyncNotice["kind"], number> = {
  remote: 4200,
  conflict: 5600,
  bulk: 4200,
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
    <div className="flex w-full max-w-[420px] flex-col items-stretch gap-2">
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

  function flyAway(toX: number, toY: number) {
    if (dismissed.current) return;
    dismissed.current = true;
    haptic("light");
    if (reduced) {
      onDismissRef.current();
      return;
    }
    void Promise.all([
      animate(x, toX, { duration: 0.18, ease: [0.4, 0, 1, 1] }),
      animate(y, toY, { duration: 0.18, ease: [0.4, 0, 1, 1] }),
    ]).then(() => onDismissRef.current());
  }

  return (
    <motion.div
      layout
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={
        reduced
          ? { opacity: 0 }
          : {
              opacity: 0,
              y: 10,
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
        dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
        dragElastic={{ left: 0.78, right: 0.78, top: 0.3, bottom: 0.88 }}
        dragMomentum={false}
        dragTransition={{ bounceStiffness: 560, bounceDamping: 38 }}
        onDragStart={() => {
          dragging.current = true;
        }}
        onDragEnd={(_, info) => {
          dragging.current = false;
          const goX = Math.abs(info.offset.x) > 64 || Math.abs(info.velocity.x) > 580;
          const goDown = info.offset.y > 32 || info.velocity.y > 500;
          const goUp = info.offset.y < -52 || info.velocity.y < -680;
          if (goX) {
            flyAway(Math.sign(info.offset.x || info.velocity.x || 1) * 420, info.offset.y);
          } else if (goDown) {
            flyAway(info.offset.x, 170);
          } else if (goUp) {
            flyAway(info.offset.x, -150);
          }
        }}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="cursor-grab touch-none will-change-transform active:cursor-grabbing"
      >
        <div
          className={cn(
            "sync-notice-card relative flex w-full items-start gap-2.5 overflow-hidden px-3 py-2.5"
          )}
        >
          <span
            aria-hidden
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
          >
            <Cloud className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          <p className="min-w-0 flex-1 py-0.5">
            <span className="block truncate text-[13px] font-medium leading-tight text-ink">
              {copy.title}
            </span>
            <span className="mt-0.5 block text-[12px] leading-snug text-ink-soft">
              {copy.detail}
            </span>
          </p>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              haptic("light");
              onDismissRef.current();
            }}
            aria-label="Dismiss"
            className="-mr-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink"
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
