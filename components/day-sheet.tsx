"use client";

import { useRef } from "react";
import { motion, useDragControls } from "framer-motion";
import { X } from "lucide-react";
import { format } from "date-fns";
import { useCategory } from "@/lib/store";
import { dayLabel } from "@/lib/date-utils";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";
import { ItemCard } from "@/components/item-card";
import { EmptyState } from "@/components/empty-state";
import { motion as motionTokens } from "@/lib/motion";
import type { Item } from "@/lib/types";

export function DaySheet({
  date,
  items,
  onClose,
}: {
  date: Date;
  items: Item[];
  onClose: () => void;
}) {
  useLockBodyScroll(true);
  const dragControls = useDragControls();
  const closeGuard = useRef(false);
  const label = dayLabel(date);
  const showDate = label === "Today" || label === "Tomorrow" || label === "Yesterday";

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: motionTokens.standard }}
        onClick={onClose}
        className="overlay-scrim absolute inset-0 backdrop-blur-[2px]"
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        initial={{ y: 28, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 28, opacity: 0 }}
        transition={{ duration: motionTokens.emphasis, ease: motionTokens.ease }}
        drag="y"
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.04, bottom: 0.55 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 88 || info.velocity.y > 700) onClose();
        }}
        className="glass absolute inset-x-0 bottom-0 flex max-h-[min(78dvh,640px)] flex-col rounded-t-2xl pb-[max(env(safe-area-inset-bottom),0.75rem)]"
      >
        <div
          className="flex shrink-0 cursor-grab flex-col items-center pt-2 active:cursor-grabbing"
          onPointerDown={(e) => dragControls.start(e)}
        >
          <span aria-hidden className="h-1 w-10 rounded-full bg-line-strong" />
          <div className="flex w-full items-start justify-between gap-3 px-4 pb-2 pt-3">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-ink">{label}</p>
              {showDate && (
                <p className="mt-0.5 text-[12.5px] text-ink-faint">{format(date, "EEEE, MMMM d")}</p>
              )}
            </div>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (closeGuard.current) return;
                closeGuard.current = true;
                onClose();
              }}
              aria-label="Close"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-ink-soft"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
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
