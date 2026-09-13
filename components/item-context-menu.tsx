"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { addDays } from "date-fns";
import {
  ArrowRight,
  CalendarClock,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Copy,
  PanelRightOpen,
  PlayCircle,
  Trash2,
} from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore, type ContextMenuRequest } from "@/lib/ui-store";
import { dayKey } from "@/lib/date-utils";
import { duplicateItem, rescheduleToDay, setStatusWithUndo } from "@/lib/item-actions";
import { takeMenuOpener } from "@/lib/item-menu";
import { toDateInputValue } from "@/lib/date-utils";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Item } from "@/lib/types";

export function ItemContextMenu() {
  const request = useUIStore((s) => s.contextMenu);
  const item = useDatebookStore((s) =>
    request ? s.items.find((i) => i.id === request.itemId) : undefined
  );
  const close = useUIStore((s) => s.closeContextMenu);

  useEffect(() => {
    if (request && !item) close();
  }, [request, item, close]);

  return (
    <AnimatePresence>
      {request && item && (
        <MenuBody key={`${request.itemId}:${request.x}:${request.y}`} request={request} item={item} />
      )}
    </AnimatePresence>
  );
}

type Section = "main" | "reschedule" | "date";

function MenuBody({ request, item }: { request: ContextMenuRequest; item: Item }) {
  const close = useUIStore((s) => s.closeContextMenu);
  const openInspector = useUIStore((s) => s.openInspector);
  const deleteItem = useDatebookStore((s) => s.deleteItem);
  const [section, setSection] = useState<Section>(request.section === "reschedule" ? "reschedule" : "main");
  const [pos, setPos] = useState({ left: request.x, top: request.y });
  const [date, setDate] = useState(() => toDateInputValue(item.at));
  const ref = useRef<HTMLDivElement>(null);
  const fromKey = request.dayKey ?? dayKey(new Date(item.at));
  const work = item.type !== "event";
  const status = item.status ?? "todo";

  // Keep the whole menu on screen: flip up near the bottom, in from the right.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(request.x, window.innerWidth - width - 8));
    const top =
      request.y + height > window.innerHeight - 8 ? Math.max(8, request.y - height) : request.y;
    setPos((p) => (p.left === left && p.top === top ? p : { left, top }));
  }, [request.x, request.y, section]);

  useEffect(() => {
    // Land on the first real choice (or the date field), not the "back" row.
    const first = ref.current?.querySelector<HTMLElement>('input, [role="menuitem"]:not([data-back])');
    first?.focus({ preventScroll: true });
  }, [section]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const dismiss = () => close();
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    document.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
      document.removeEventListener("scroll", dismiss, true);
    };
  }, [close]);

  // Hand focus back to whatever opened the menu once it's gone.
  useEffect(() => {
    const menu = ref.current;
    return () => {
      const back = takeMenuOpener();
      const active = document.activeElement;
      if (back?.isConnected && (!active || active === document.body || menu?.contains(active))) {
        back.focus({ preventScroll: true });
      }
    };
  }, []);

  function run(fn: () => void) {
    haptic("light");
    close();
    fn();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape" || (e.key === "ArrowLeft" && section !== "main")) {
      e.preventDefault();
      e.stopPropagation();
      if (section === "main") close();
      else setSection(section === "date" ? "reschedule" : "main");
      return;
    }
    if (e.key === "Tab") {
      if (section === "date") return;
      e.preventDefault();
      close();
      return;
    }
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if ((e.key === "Enter" || e.key === " ") && index >= 0) {
      // Activate the item ourselves (and cancel the native activation) so
      // Enter behaves the same from every keyboard and assistive tech.
      e.preventDefault();
      items[index].click();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      const delta = e.key === "ArrowDown" ? 1 : -1;
      items[(index + delta + items.length) % items.length].focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (e.key === "ArrowRight" && document.activeElement?.hasAttribute("data-submenu")) {
      e.preventDefault();
      (document.activeElement as HTMLElement).click();
    }
  }

  const today = new Date();

  return (
    <motion.div
      ref={ref}
      role="menu"
      aria-label={`Actions for ${item.title}`}
      initial={{ opacity: 0, scale: 0.96, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: motionTokens.exit, ease: motionTokens.easeIn } }}
      transition={motionTokens.springSnappy}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos.left, top: pos.top, transformOrigin: "top left" }}
      className="fixed z-[85] w-[232px] rounded-xl border border-line bg-surface p-1 text-[13px] text-ink shadow-[0_16px_40px_-14px_rgb(0_0_0/0.35)]"
    >
      {section === "main" && (
        <>
          <p className="truncate px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-ink-faint">{item.title}</p>
          <MenuItem icon={PanelRightOpen} onSelect={() => run(() => openInspector(item.id))} hint="↵">
            Open details
          </MenuItem>
          {work && (
            <>
              <Separator />
              {status !== "done" && (
                <MenuItem icon={Check} onSelect={() => run(() => setStatusWithUndo(item, "done"))}>
                  Mark done
                </MenuItem>
              )}
              {status !== "doing" && (
                <MenuItem icon={PlayCircle} onSelect={() => run(() => setStatusWithUndo(item, "doing"))}>
                  Mark in progress
                </MenuItem>
              )}
              {status !== "todo" && (
                <MenuItem icon={CircleDashed} onSelect={() => run(() => setStatusWithUndo(item, "todo"))}>
                  Move to to do
                </MenuItem>
              )}
            </>
          )}
          <Separator />
          <MenuItem icon={CalendarClock} onSelect={() => setSection("reschedule")} submenu>
            Reschedule
          </MenuItem>
          <MenuItem icon={Copy} onSelect={() => run(() => duplicateItem(item))}>
            Duplicate
          </MenuItem>
          <Separator />
          <MenuItem
            icon={Trash2}
            tone="warn"
            onSelect={() => run(() => deleteItem(item.id))}
          >
            {item.repeatId ? "Delete this occurrence" : "Delete"}
          </MenuItem>
        </>
      )}

      {section === "reschedule" && (
        <>
          <BackRow onBack={() => setSection("main")}>{work ? "Move due date" : "Move to"}</BackRow>
          <MenuItem icon={ArrowRight} onSelect={() => run(() => rescheduleToDay(item, dayKey(today), fromKey))}>
            Today
          </MenuItem>
          <MenuItem
            icon={ArrowRight}
            onSelect={() => run(() => rescheduleToDay(item, dayKey(addDays(today, 1)), fromKey))}
          >
            Tomorrow
          </MenuItem>
          <MenuItem
            icon={ArrowRight}
            onSelect={() =>
              run(() => rescheduleToDay(item, dayKey(addDays(new Date(`${fromKey}T12:00:00`), 1)), fromKey))
            }
          >
            A day later
          </MenuItem>
          <MenuItem
            icon={ArrowRight}
            onSelect={() =>
              run(() => rescheduleToDay(item, dayKey(addDays(new Date(`${fromKey}T12:00:00`), 7)), fromKey))
            }
          >
            A week later
          </MenuItem>
          <Separator />
          <MenuItem icon={CalendarPlus} onSelect={() => setSection("date")} submenu>
            Pick a date…
          </MenuItem>
        </>
      )}

      {section === "date" && (
        <form
          className="flex flex-col gap-2 p-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (!date) return;
            run(() => rescheduleToDay(item, date, fromKey));
          }}
        >
          <BackRow onBack={() => setSection("reschedule")}>Pick a date</BackRow>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="New date"
            className="min-h-9 w-full rounded-md border border-line bg-surface px-2 text-[13px] text-ink focus:border-accent focus:outline-none focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
          <button
            type="submit"
            disabled={!date}
            className="min-h-9 rounded-md bg-accent px-3 text-[12.5px] font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Move
          </button>
        </form>
      )}
    </motion.div>
  );
}

function MenuItem({
  icon: Icon,
  children,
  onSelect,
  tone,
  hint,
  submenu,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  children: React.ReactNode;
  onSelect: () => void;
  tone?: "warn";
  hint?: string;
  submenu?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      data-submenu={submenu ? "" : undefined}
      onClick={onSelect}
      className={cn(
        "flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left outline-none",
        "transition-colors duration-[var(--motion-micro)]",
        tone === "warn"
          ? "text-warn hover:bg-warn-soft focus-visible:bg-warn-soft focus:bg-warn-soft"
          : "hover:bg-surface-sunken focus:bg-surface-sunken"
      )}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", tone === "warn" ? "text-warn" : "text-ink-faint")} strokeWidth={1.9} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="text-[11px] text-ink-faint">{hint}</span>}
      {submenu && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={2} />}
    </button>
  );
}

function BackRow({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      data-back=""
      onClick={onBack}
      className="mb-0.5 flex min-h-8 w-full items-center gap-1.5 rounded-lg px-1.5 text-left text-[11.5px] font-medium text-ink-soft outline-none hover:bg-surface-sunken focus:bg-surface-sunken"
    >
      <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
      {children}
    </button>
  );
}

function Separator() {
  return <div role="separator" className="mx-2 my-1 h-px bg-line" />;
}
