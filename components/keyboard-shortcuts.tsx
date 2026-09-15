"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useUIStore } from "@/lib/ui-store";
import { useResolvedPathname, navigateTab } from "@/lib/tab-nav";
import { undoLatest } from "@/lib/action-undo";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";
import { Scrim } from "@/components/ui/scrim";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";

function isMac() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

const noopSubscribe = () => () => {};

/** "⌘" on Apple keyboards, "Ctrl" everywhere else (and on the server). */
export function useModKeyLabel() {
  return useSyncExternalStore(noopSubscribe, () => (isMac() ? "⌘" : "Ctrl"), () => "Ctrl");
}

type Shortcut = { keys: string[]; label: string };

function shortcutGroups(mod: string): { title: string; items: Shortcut[] }[] {
  return [
    {
      title: "General",
      items: [
        { keys: [mod, "K"], label: "Search" },
        { keys: ["N"], label: "New item" },
        { keys: ["A"], label: "Ask the assistant" },
        { keys: [mod, "Z"], label: "Undo last change" },
        { keys: ["?"], label: "Keyboard shortcuts" },
      ],
    },
    {
      title: "Go to",
      items: [
        { keys: ["1"], label: "Today" },
        { keys: ["2"], label: "Calendar" },
        { keys: ["3"], label: "Agenda" },
        { keys: ["4"], label: "Schedule" },
      ],
    },
    {
      title: "Calendar",
      items: [
        { keys: ["T"], label: "Today page; on Calendar, jump to today" },
        { keys: ["M"], label: "Month view" },
        { keys: ["W"], label: "Week view" },
        { keys: ["←", "→"], label: "Previous / next" },
        { keys: ["D"], label: "Jump to a date" },
        { keys: ["\\"], label: "Show or hide the side panel" },
      ],
    },
    {
      title: "Items",
      items: [
        { keys: ["Right-click"], label: "Item actions" },
        { keys: ["Shift", "F10"], label: "Item actions (keyboard)" },
        { keys: ["Drag"], label: "Move, resize, or create on the week" },
      ],
    },
  ];
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

/** App-wide single-key shortcuts, plus the reference sheet that lists them. */
export function KeyboardShortcuts() {
  const router = useRouter();
  const pathname = useResolvedPathname();
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing) return;
      const typing = isTyping(e.target);
      const mod = e.metaKey || e.ctrlKey;

      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "z") {
        if (typing || document.querySelector('[aria-modal="true"]')) return;
        if (undoLatest()) {
          e.preventDefault();
          haptic("success");
        }
        return;
      }
      if (mod || e.altKey || typing) return;
      // Popovers with their own arrow-key handling (date picker, menus) opt out.
      if ((e.target as HTMLElement | null)?.closest?.("[data-no-shortcuts]")) return;

      const ui = useUIStore.getState();
      if (ui.contextMenu || ui.commandPaletteOpen || document.querySelector('[aria-modal="true"]')) return;

      const onCalendar = pathRef.current === "/calendar";
      const toCalendar = () => {
        if (!onCalendar) navigateTab(router, "/calendar");
      };
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      let handled = true;

      if (e.key === "?") ui.setShortcutsOpen(true);
      else if (e.shiftKey) handled = false;
      else if (key === "/") ui.setCommandPaletteOpen(true);
      else if (key === "n" || key === "c") {
        if (pathRef.current === "/settings") handled = false;
        else {
          ui.setQuickAddPrefill("");
          ui.setQuickAddOpen(true);
        }
      } else if (key === "a") ui.setAIDrawerOpen(true);
      else if (key === "1") navigateTab(router, "/today");
      else if (key === "2") navigateTab(router, "/calendar");
      else if (key === "3") navigateTab(router, "/agenda");
      else if (key === "4") navigateTab(router, "/schedule");
      else if (key === "t") {
        if (onCalendar) ui.sendCalendarCommand({ kind: "today" });
        else navigateTab(router, "/today");
      } else if (key === "m" || key === "w") {
        toCalendar();
        ui.sendCalendarCommand({ kind: "mode", mode: key === "m" ? "month" : "week" });
      } else if (key === "d") {
        toCalendar();
        ui.sendCalendarCommand({ kind: "jump" });
      } else if (onCalendar && (key === "ArrowLeft" || key === "ArrowRight")) {
        ui.sendCalendarCommand({ kind: "step", dir: key === "ArrowLeft" ? -1 : 1 });
      } else if (onCalendar && key === "\\") {
        ui.sendCalendarCommand({ kind: "toggle-pane" });
      } else handled = false;

      if (handled) e.preventDefault();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  const open = useUIStore((s) => s.shortcutsOpen);
  return <AnimatePresence>{open && <ShortcutSheet />}</AnimatePresence>;
}

function ShortcutSheet() {
  const setOpen = useUIStore((s) => s.setShortcutsOpen);
  const mod = useModKeyLabel();
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, true);
  useLockBodyScroll(true);

  // Esc closes the sheet wherever focus is — including before focus has
  // moved into it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setOpen]);

  return (
    <div className="viewport-pinned-overlay fixed inset-0 z-50 flex items-center justify-center p-4">
      <Scrim label="Close keyboard shortcuts" tone="light" onClick={() => setOpen(false)} />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 4, transition: { duration: motionTokens.exit, ease: motionTokens.easeIn } }}
        transition={motionTokens.spring}
        className="relative max-h-[calc(100dvh-2rem)] w-full max-w-[640px] overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-[0_24px_64px_-24px_rgb(0_0_0/0.42)]"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-[16px] font-semibold text-ink">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {shortcutGroups(mod).map((group) => (
            <section key={group.title}>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint">{group.title}</p>
              <ul className="flex flex-col">
                {group.items.map((s) => (
                  <li key={s.label} className="flex min-h-8 items-center justify-between gap-3 text-[13px] text-ink-soft">
                    <span>{s.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {s.keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-sunken px-1.5 font-sans text-[11px] font-medium leading-none text-ink-soft">
      {children}
    </kbd>
  );
}
