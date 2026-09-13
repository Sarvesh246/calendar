"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarSearch, X } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useMediaQuery } from "@/lib/use-media-query";
import { dayKey } from "@/lib/date-utils";
import { navigateTab, useResolvedPathname } from "@/lib/tab-nav";
import { motion as motionTokens } from "@/lib/motion";
import { StatusSegmented } from "@/components/item-card";
import { MobileItemSheet } from "@/components/mobile-item-sheet";
import type { Item } from "@/lib/types";

const ItemEditor = dynamic(
  () => import("@/components/item-editor").then((m) => ({ default: m.ItemEditor })),
  {
    ssr: false,
    loading: () => (
      <div role="status" className="space-y-3">
        <span className="sr-only">Loading item details…</span>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} aria-hidden className="h-9 animate-pulse rounded-md bg-surface-sunken" />
        ))}
      </div>
    ),
  }
);

const TYPE_LABEL: Record<Item["type"], string> = {
  event: "Event",
  assignment: "Assignment",
  task: "Task",
};

/**
 * One place to see and edit an item, whichever view it was found in. It sits
 * beside the page rather than over it, so opening an item from the calendar,
 * Today, the agenda or search never costs you your place.
 */
export function ItemInspector() {
  const id = useUIStore((s) => s.inspectorItemId);
  const close = useUIStore((s) => s.closeInspector);
  const item = useDatebookStore((s) => (id ? s.items.find((i) => i.id === id) : undefined));
  const mobile = useMediaQuery("(max-width: 767px)");

  // Deleted (here or on another device): nothing left to inspect.
  useEffect(() => {
    if (id && !item) close();
  }, [id, item, close]);

  if (mobile) {
    return item ? <MobileInspector item={item} onClose={close} /> : null;
  }
  return <AnimatePresence>{item && <InspectorPanel key="inspector" item={item} />}</AnimatePresence>;
}

function MobileInspector({ item, onClose }: { item: Item; onClose: () => void }) {
  const category = useDatebookStore((s) => s.categories.find((c) => c.id === item.categoryId));
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  return (
    <MobileItemSheet title="Edit item" onClose={onClose}>
      <ItemEditor
        key={item.id}
        item={item}
        category={category}
        clock24h={clock24h}
        StatusSegmented={StatusSegmented}
        onCollapse={onClose}
      />
    </MobileItemSheet>
  );
}

function InspectorPanel({ item }: { item: Item }) {
  const router = useRouter();
  const pathname = useResolvedPathname();
  const close = useUIStore((s) => s.closeInspector);
  const setCalendarFocusDate = useUIStore((s) => s.setCalendarFocusDate);
  const category = useDatebookStore((s) => s.categories.find((c) => c.id === item.categoryId));
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const ref = useRef<HTMLElement>(null);

  // Take focus on open and give it back on close — but only if it was ours.
  useEffect(() => {
    const panel = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    if (!panel?.contains(document.activeElement)) panel?.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      if (previous?.isConnected && (!active || active === document.body || panel?.contains(active))) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);

  // Esc closes it from anywhere, unless something on top (a dialog, a menu)
  // is the thing Esc is meant for.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]') || useUIStore.getState().contextMenu) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <motion.aside
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-label={`${TYPE_LABEL[item.type]} details`}
      tabIndex={-1}
      initial={{ opacity: 0, x: 28 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20, transition: { duration: motionTokens.exit, ease: motionTokens.easeIn } }}
      transition={motionTokens.spring}
      className="fixed bottom-4 right-4 top-4 z-[44] flex w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_64px_-24px_rgb(0_0_0/0.42)] outline-none"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: category?.color ?? "#8a8a94" }}
        />
        <p className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-soft">
          {item.workFor ? "Planned work" : TYPE_LABEL[item.type]}
          {category ? ` · ${category.name}` : ""}
        </p>
        {pathname !== "/calendar" && (
          <button
            type="button"
            onClick={() => {
              setCalendarFocusDate(dayKey(new Date(item.at)));
              navigateTab(router, "/calendar");
            }}
            className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <CalendarSearch className="h-3.5 w-3.5" strokeWidth={1.9} />
            Show on calendar
          </button>
        )}
        <button
          type="button"
          onClick={close}
          aria-label="Close details"
          title="Close (Esc)"
          className="flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-3">
        <ItemEditor
          key={item.id}
          item={item}
          category={category}
          clock24h={clock24h}
          StatusSegmented={StatusSegmented}
          variant="inspector"
        />
      </div>
    </motion.aside>
  );
}
