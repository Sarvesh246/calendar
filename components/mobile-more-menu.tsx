"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarClock, Check, MoreHorizontal, Settings } from "lucide-react";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useResolvedPathname } from "@/lib/tab-nav";

/**
 * Phone overflow for rooms only: Schedule and Settings.
 * Filters and Focus live on the cluster / Today header, not here.
 */
export function MobileMoreMenu({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = useResolvedPathname();
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
        aria-label="More"
        aria-expanded={open}
        onClick={() => {
          haptic("light");
          setOpen((v) => !v);
        }}
        className={cn(
          "relative h-11 w-11 rounded-full bg-transparent hover:bg-surface-sunken",
          className
        )}
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={1.9} />
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
              icon={<CalendarClock className="h-3.5 w-3.5 text-ink-faint" strokeWidth={1.9} />}
              label="Schedule"
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuRow({
  icon,
  label,
  checked,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
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
        <span className="min-w-0 truncate">{label}</span>
      </span>
      {checked && <Check className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2.5} />}
    </button>
  );
}
