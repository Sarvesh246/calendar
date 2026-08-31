"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  CalendarDays,
  CalendarRange,
  ListChecks,
  Plus,
  Settings,
  Sparkles,
  Sun,
  Upload,
} from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";
import { dayKey, isOverdue } from "@/lib/date-utils";
import { isToday } from "date-fns";
import type { Item } from "@/lib/types";

export function CommandPalette() {
  const router = useRouter();
  const open = useUIStore((s) => s.commandPaletteOpen);
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const setAIDrawerOpen = useUIStore((s) => s.setAIDrawerOpen);
  const setQuickAddPrefill = useUIStore((s) => s.setQuickAddPrefill);
  const setQuickAddOpen = useUIStore((s) => s.setQuickAddOpen);
  const items = useDatebookStore((s) => s.items);
  const categories = useDatebookStore((s) => s.categories);
  const sortedItems = useMemo(
    () =>
      [...items]
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
        .slice(0, 250),
    [items]
  );
  const setFocusedItemId = useUIStore((s) => s.setFocusedItemId);
  const setCalendarFocusDate = useUIStore((s) => s.setCalendarFocusDate);
  useLockBodyScroll(open);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

  function go(path: string) {
    router.push(path);
    setOpen(false);
  }

  function createNew() {
    setQuickAddPrefill("");
    setQuickAddOpen(true);
    setOpen(false);
  }

  function openItem(item: Item) {
    setFocusedItemId(item.id);
    setOpen(false);
    const at = new Date(item.at);
    if (isOverdue(item)) {
      router.push("/agenda");
      return;
    }
    if (isToday(at)) {
      router.push("/today");
      return;
    }
    setCalendarFocusDate(dayKey(at));
    router.push("/calendar");
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      // `palette-overlay` / `palette-panel` carry the enter+exit keyframes (see
      // globals.css) and key off `data-state`. cmdk's `className` prop lands on
      // its own inner Command root — a plain div nested *inside* Radix's
      // Dialog.Content — which never receives `data-state` at all, so the
      // `.palette-panel[data-state=...]` selector could never match and the
      // panel just snapped open/closed with no animation. `contentClassName`
      // is what actually reaches Dialog.Content, the element Radix stamps
      // with `data-state="open"/"closed"` — that's where the positioning and
      // the animation trigger both need to live.
      overlayClassName="palette-overlay overlay-scrim-light fixed inset-0 z-50 backdrop-blur-[2px]"
      contentClassName="palette-panel fixed left-1/2 top-[max(1rem,calc(env(safe-area-inset-top)+0.75rem))] z-50 w-[calc(100%-1.5rem)] max-w-[560px] -translate-x-1/2"
      className="glass block w-full overflow-hidden rounded-xl"
      style={{ maxHeight: "calc(var(--visible-height, 100dvh) - 1.5rem - var(--keyboard-inset, 0px))" }}
    >
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <Sparkles className="h-4 w-4 shrink-0 text-ink-faint" strokeWidth={1.75} />
        <Command.Input
          autoFocus
          placeholder="Search Datebook…"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-faint focus:outline-none"
        />
      </div>

      <Command.List
        // Shrink to fit above the on-screen keyboard so results aren't hidden.
        style={{ maxHeight: "max(140px, calc(var(--visible-height, 100dvh) - 14rem))" }}
        className="overflow-y-auto p-2"
      >
        <Command.Empty className="px-3 py-6 text-center text-[13px] text-ink-faint">
          No results.
        </Command.Empty>

        <Command.Group heading="Create" className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint [&_[cmdk-group-items]]:mt-1.5">
          <Command.Item onSelect={createNew} className="cmdk-row min-h-11">
            <Plus className="h-4 w-4" strokeWidth={1.75} /> New item
          </Command.Item>
        </Command.Group>

        <Command.Group heading="Navigate" className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint [&_[cmdk-group-items]]:mt-1.5">
          <Command.Item onSelect={() => go("/today")} className="cmdk-row min-h-11">
            <Sun className="h-4 w-4" strokeWidth={1.75} /> Today
          </Command.Item>
          <Command.Item onSelect={() => go("/calendar")} className="cmdk-row min-h-11">
            <CalendarDays className="h-4 w-4" strokeWidth={1.75} /> Calendar
          </Command.Item>
          <Command.Item onSelect={() => go("/agenda")} className="cmdk-row min-h-11">
            <ListChecks className="h-4 w-4" strokeWidth={1.75} /> Agenda
          </Command.Item>
        </Command.Group>

        <Command.Group heading="Actions" className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint [&_[cmdk-group-items]]:mt-1.5">
          <Command.Item
            onSelect={() => {
              setAIDrawerOpen(true);
              setOpen(false);
            }}
            className="cmdk-row min-h-11"
          >
            <Sparkles className="h-4 w-4" strokeWidth={1.75} /> Ask Gemini
          </Command.Item>
          <Command.Item onSelect={() => go("/settings")} className="cmdk-row min-h-11">
            <Upload className="h-4 w-4" strokeWidth={1.75} /> Import calendar
          </Command.Item>
          <Command.Item onSelect={() => go("/settings")} className="cmdk-row min-h-11">
            <Settings className="h-4 w-4" strokeWidth={1.75} /> Settings
          </Command.Item>
        </Command.Group>

        {items.length > 0 && (
          <Command.Group heading="Items" className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint [&_[cmdk-group-items]]:mt-1.5">
            {sortedItems.map((item) => {
              const category = categories.find((c) => c.id === item.categoryId);
              return (
                <Command.Item
                  key={item.id}
                  value={`${item.title} ${item.description ?? ""} ${item.location ?? ""} ${category?.name ?? ""}`}
                  onSelect={() => openItem(item)}
                  className="cmdk-row min-h-11"
                >
                  <CalendarRange className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">{item.title}</span>
                  {category && (
                    <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: category.color }} />
                  )}
                </Command.Item>
              );
            })}
          </Command.Group>
        )}
      </Command.List>

      {/* A legend, not results. As disabled `Command.Item`s these sat inside the
          filtered list, so typing left two permanently unselectable rows behind. */}
      <div className="hidden items-center gap-4 border-t border-line px-4 py-2 text-[11px] text-ink-faint sm:flex">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          to navigate
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd>
          to select
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <Kbd>esc</Kbd>
          to close
        </span>
      </div>
    </Command.Dialog>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.4em] items-center justify-center rounded border border-line bg-surface-sunken px-1 py-0.5 font-mono text-[10px] leading-none text-ink-soft">
      {children}
    </kbd>
  );
}
