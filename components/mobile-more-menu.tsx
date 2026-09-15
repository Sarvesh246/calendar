"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarClock, Check, Minimize2, MoreHorizontal, Settings, SlidersHorizontal } from "lucide-react";
import { summariseFilters } from "@/lib/filter-summary";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useAllViews } from "@/components/saved-views";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useResolvedPathname } from "@/lib/tab-nav";

/**
 * Phone overflow that replaces the old standalone Filter button: Filters,
 * Schedule, Settings, and Focus — always one tap from the top cluster on every
 * route, including the rooms that used to hide Filter entirely.
 */
export function MobileMoreMenu({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = useResolvedPathname();
  const setFilterOpen = useUIStore((s) => s.setFilterOpen);
  const toggleFocusMode = useUIStore((s) => s.toggleFocusMode);
  const categoryFilter = useUIStore((s) => s.categoryFilter);
  const activeViewId = useUIStore((s) => s.activeViewId);
  const categories = useDatebookStore((s) => s.categories);
  const hideCompleted = useDatebookStore((s) => s.settings.hideCompleted);
  const views = useAllViews();
  const summary = summariseFilters(
    categories,
    categoryFilter,
    hideCompleted,
    views.find((v) => v.id === activeViewId)?.name
  );
  const filtersActive = summary.active;
  const onSettings = pathname === "/settings";
  const onSchedule = pathname === "/schedule";

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <Button
        variant="tertiary"
        size="icon"
        aria-label={filtersActive ? `More — filters on (${summary.label})` : "More"}
        aria-expanded={open}
        onClick={() => {
          haptic("light");
          setOpen((v) => !v);
        }}
        className={cn(
          "relative h-11 w-11 rounded-full bg-transparent hover:bg-surface-sunken",
          className,
          filtersActive && "max-md:bg-accent-soft max-md:text-accent max-md:ring-1 max-md:ring-accent"
        )}
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={1.9} />
        <AnimatePresence initial={false}>
          {filtersActive && (
            <motion.span
              key="dot"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={motionTokens.springSnappy}
              className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent ring-2 ring-surface"
            />
          )}
        </AnimatePresence>
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{
              opacity: 0,
              scale: 0.96,
              y: -2,
              transition: { duration: motionTokens.exit, ease: motionTokens.easeIn },
            }}
            transition={motionTokens.springSnappy}
            style={{ transformOrigin: "top right" }}
            className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[200px] rounded-xl border border-line bg-surface p-1"
          >
            <MenuRow
              icon={<SlidersHorizontal className="h-3.5 w-3.5 text-ink-faint" strokeWidth={1.9} />}
              label="Filters"
              hint={filtersActive ? summary.label : undefined}
              onClick={() => {
                setOpen(false);
                setFilterOpen(true);
              }}
            />
            <MenuRow
              icon={<CalendarClock className="h-3.5 w-3.5 text-ink-faint" strokeWidth={1.9} />}
              label="Full schedule"
              checked={onSchedule}
              onClick={() => {
                setOpen(false);
                if (!onSchedule) router.push("/schedule");
              }}
            />
            <MenuRow
              icon={<Settings className="h-3.5 w-3.5 text-ink-faint" strokeWidth={1.9} />}
              label="Settings"
              checked={onSettings}
              onClick={() => {
                setOpen(false);
                if (!onSettings) router.push("/settings");
              }}
            />
            <MenuRow
              icon={<Minimize2 className="h-3.5 w-3.5 text-ink-faint" strokeWidth={1.9} />}
              label="Focus"
              onClick={() => {
                toggleFocusMode();
                setOpen(false);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuRow({
  icon,
  label,
  hint,
  checked,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  checked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press-none flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-2.5 text-left text-[13px] text-ink transition-colors duration-[var(--motion-micro)] active:bg-surface-sunken"
    >
      <span className="flex min-w-0 items-center gap-2">
        {icon}
        <span className="min-w-0 truncate">
          {label}
          {hint ? <span className="text-ink-faint"> · {hint}</span> : null}
        </span>
      </span>
      {checked && <Check className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2.5} />}
    </button>
  );
}
