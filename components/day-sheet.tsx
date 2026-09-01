"use client";

import { useEffect, useId, useRef, useState } from "react";
import { motion, useDragControls } from "framer-motion";
import { Plus, X } from "lucide-react";
import { format } from "date-fns";
import { useCategory } from "@/lib/store";
import { dayLabel } from "@/lib/date-utils";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";
import { ItemCard } from "@/components/item-card";
import { EmptyState } from "@/components/empty-state";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";
import type { Item } from "@/lib/types";

function useBelowLg() {
  const [below, setBelow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => setBelow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return below;
}

export function DaySheet({
  date,
  items,
  onClose,
  onAdd,
}: {
  date: Date;
  items: Item[];
  onClose: () => void;
  onAdd?: () => void;
}) {
  const visible = useBelowLg();
  useLockBodyScroll(visible);
  const dragControls = useDragControls();
  const closeGuard = useRef(false);
  const headingId = useId();
  const label = dayLabel(date);
  const showDate = label === "Today" || label === "Tomorrow" || label === "Yesterday";
  const [dragging, setDragging] = useState(false);

  // The sheet is keyed stably in the calendar page (so picking a second day
  // doesn't stack two sheets), which means this instance can be re-shown after a
  // close. Re-arm the double-close guard whenever the day changes.
  useEffect(() => {
    closeGuard.current = false;
  }, [date]);

  useEffect(() => {
    if (!visible) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, onClose]);

  if (!visible) return null;

  const close = () => {
    if (closeGuard.current) return;
    closeGuard.current = true;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
        onClick={close}
        className="overlay-scrim absolute inset-0"
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        // A sheet is a physical object being thrown up from the bottom edge, so
        // it arrives on a spring. The old tween made it glide in at a constant
        // rate and stop dead, which is the classic "web modal" tell.
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%", transition: { duration: motionTokens.exit, ease: motionTokens.easeIn } }}
        transition={motionTokens.springGentle}
        drag="y"
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.02, bottom: 0.6 }}
        // Without this, releasing a drag snapped back on framer's default
        // underdamped spring and the sheet bounced twice before settling.
        dragTransition={{ bounceStiffness: 420, bounceDamping: 40 }}
        onDragStart={() => setDragging(true)}
        onDragEnd={(_, info) => {
          setDragging(false);
          if (info.offset.y > 88 || info.velocity.y > 700) {
            haptic("light");
            close();
          }
        }}
        className="absolute inset-x-0 bottom-0 flex max-h-[min(82dvh,680px)] flex-col rounded-t-2xl border-t border-line bg-surface"
      >
        <div
          className="flex shrink-0 cursor-grab touch-none flex-col items-center pt-2 active:cursor-grabbing"
          onPointerDown={(e) => dragControls.start(e)}
        >
          {/* The grab handle thickens while you hold it — the only feedback that
              the drag has actually been picked up. */}
          <motion.span
            aria-hidden
            animate={{ scaleX: dragging ? 1.25 : 1, opacity: dragging ? 1 : 0.75 }}
            transition={motionTokens.springSnappy}
            className="h-1 w-10 rounded-full bg-line-strong"
          />
          <div className="flex w-full items-start justify-between gap-3 px-4 pb-2 pt-3">
            <div className="min-w-0">
              <p id={headingId} className="text-[16px] font-semibold text-ink">
                {label}
              </p>
              <p className="mt-0.5 text-[12.5px] text-ink-faint">
                {showDate
                  ? format(date, "EEEE, MMMM d")
                  : `${items.length} thing${items.length === 1 ? "" : "s"} scheduled`}
              </p>
            </div>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                close();
              }}
              aria-label="Close"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-ink-soft transition-colors hover:text-ink"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-0">
          {onAdd && (
            <button
              type="button"
              onClick={onAdd}
              className="mb-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line text-[13px] font-medium text-ink-soft transition-colors active:border-accent active:bg-accent-soft active:text-accent"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              Add to this day
            </button>
          )}
          {items.length === 0 ? (
            <EmptyState title="Nothing scheduled." sub={`Free day on ${format(date, "MMM d")}.`} />
          ) : (
            <div className="flex flex-col gap-2">
              {items.map((item) => (
                <SheetItem key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function SheetItem({ item }: { item: Item }) {
  const category = useCategory(item.categoryId);
  return <ItemCard item={item} category={category} />;
}
