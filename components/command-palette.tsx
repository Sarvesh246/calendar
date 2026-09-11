"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  CalendarClock,
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
import { isToday, startOfDay } from "date-fns";
import type { Item } from "@/lib/types";
import { searchItems } from "@/lib/search";

function sortPaletteItems(items: Item[]) {
  const cutoff = startOfDay(new Date()).getTime();
  const time = (i: Item) => new Date(i.at).getTime();
  const upcoming = items.filter((i) => time(i) >= cutoff).sort((a, b) => time(a) - time(b));
  const past = items.filter((i) => !(time(i) >= cutoff)).sort((a, b) => time(b) - time(a));
  return [...upcoming, ...past];
}

export function CommandPalette() {
  const open = useUIStore((s) => s.commandPaletteOpen);
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen);

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

  if (!open) return null;
  return <CommandPaletteDialog />;
}

function CommandPaletteDialog() {
  const router = useRouter();
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const setAIDrawerOpen = useUIStore((s) => s.setAIDrawerOpen);
  const askAI = useUIStore((s) => s.askAI);
  const [query, setQuery] = useState("");
  const setQuickAddPrefill = useUIStore((s) => s.setQuickAddPrefill);
  const setQuickAddOpen = useUIStore((s) => s.setQuickAddOpen);
  const [{ sortedItems, categories }] = useState(() => {
    const { items, categories } = useDatebookStore.getState();
    return { sortedItems: sortPaletteItems(items), categories };
  });
  const setFocusedItemId = useUIStore((s) => s.setFocusedItemId);
  const setCalendarFocusDate = useUIStore((s) => s.setCalendarFocusDate);
  useLockBodyScroll(true);
  const visibleItems = query.trim()
    ? searchItems(sortedItems, categories, query).slice(0, 100)
    : sortedItems.slice(0, 50);

  /** Clearing the query on close keeps a stale one from being re-asked the
   *  next time the palette opens. */
  function setPaletteOpen(next: boolean) {
    if (!next) setQuery("");
    setOpen(next);
  }

  function ask(message?: string) {
    if (message?.trim()) askAI(message.trim());
    else setAIDrawerOpen(true);
    setPaletteOpen(false);
  }

  function go(path: string) {
    router.push(path);
    setPaletteOpen(false);
  }

  function createNew() {
    setQuickAddPrefill("");
    setQuickAddOpen(true);
    setPaletteOpen(false);
  }

  function openItem(item: Item) {
    const ui = useUIStore.getState();
    // You asked for this item by name, so a class filter that hides it is lifted.
    if (ui.categoryFilter?.length && item.categoryId && !ui.categoryFilter.includes(item.categoryId)) {
      ui.clearCategoryFilter();
    }
    const hidden =
      useDatebookStore.getState().settings.hideCompleted &&
      item.type !== "event" &&
      item.status === "done";
    if (!hidden) {
      setFocusedItemId(item.id);
      // A card that never mounts would otherwise hold the request and spring
      // open on some unrelated visit later.
      window.setTimeout(() => {
        if (useUIStore.getState().focusedItemId === item.id) setFocusedItemId(null);
      }, 2500);
    }
    setPaletteOpen(false);
    const at = new Date(item.at);
    if (isOverdue(item)) {
      router.push("/agenda");
      return;
    }
    // Today lists events and open work; finished work is found on the calendar.
    if (isToday(at) && (item.type === "event" || item.status !== "done")) {
      router.push("/today");
      return;
    }
    setCalendarFocusDate(dayKey(at));
    router.push("/calendar");
  }

  return (
    <Command.Dialog
      open
      onOpenChange={setPaletteOpen}
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
      overlayClassName="palette-overlay overlay-scrim-light fixed inset-0 z-50"
      // Centering lives entirely in `.palette-panel`'s `transform` (globals.css),
      // not a Tailwind `-translate-x-1/2` utility — that utility compiles to the
      // native CSS `translate` property in Tailwind v4, which stacks *on top of*
      // the `transform: translateX(-50%)` the enter/exit keyframes animate,
      // doubling the horizontal offset mid-animation. The panel would fly in
      // from off-screen left before snapping to its real centered position the
      // instant the animation ended. One property, one source of truth.
      contentClassName="palette-panel fixed left-1/2 top-[max(1rem,calc(env(safe-area-inset-top)+0.75rem))] z-50 w-[calc(100%-1.5rem)] max-w-[560px]"
      className="flex w-full flex-col overflow-hidden rounded-lg border border-line bg-surface"
      style={{ maxHeight: "calc(var(--visible-height, 100dvh) - 1.5rem)" }}
    >
      <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-3">
        <Command.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder="Search, or ask a question…"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-faint focus:outline-none"
        />
      </div>

      <Command.List
        // Shrink to fit above the on-screen keyboard so results aren't hidden.
        style={{ maxHeight: "max(140px, calc(var(--visible-height, 100dvh) - 14rem))" }}
        className="min-h-0 overflow-y-auto overscroll-contain p-2"
      >
        <Command.Empty className="px-2 py-4">
          <p className="px-1 pb-2 text-center text-[13px] text-ink-faint">
            Nothing matched &ldquo;{query}&rdquo;.
          </p>
          <button
            type="button"
            onClick={() => ask(query)}
            className="cmdk-row min-h-11 w-full text-left"
          >
            <Sparkles className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.9} />
            <span className="truncate">Ask the assistant about this</span>
          </button>
        </Command.Empty>

        {query.trim().length > 2 && (
          <Command.Group
            heading="Assistant"
            className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint [&_[cmdk-group-items]]:mt-1.5"
          >
            <Command.Item
              value={`ask assistant ${query}`}
              onSelect={() => ask(query)}
              className="cmdk-row min-h-11"
            >
              <Sparkles className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
              <span className="truncate">Ask: &ldquo;{query.trim()}&rdquo;</span>
            </Command.Item>
          </Command.Group>
        )}

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
          <Command.Item
            onSelect={() => go("/schedule")}
            value="schedule weekly timetable classes"
            className="cmdk-row min-h-11"
          >
            <CalendarClock className="h-4 w-4" strokeWidth={1.75} /> Schedule
          </Command.Item>
        </Command.Group>

        <Command.Group heading="Actions" className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint [&_[cmdk-group-items]]:mt-1.5">
          <Command.Item onSelect={() => ask()} className="cmdk-row min-h-11">
            <Sparkles className="h-4 w-4" strokeWidth={1.75} /> Ask assistant
          </Command.Item>
          <Command.Item onSelect={() => go("/settings#import")} className="cmdk-row min-h-11">
            <Upload className="h-4 w-4" strokeWidth={1.75} /> Import calendar
          </Command.Item>
          <Command.Item onSelect={() => go("/settings")} className="cmdk-row min-h-11">
            <Settings className="h-4 w-4" strokeWidth={1.75} /> Settings
          </Command.Item>
        </Command.Group>

        {sortedItems.length > 0 && (
          <Command.Group heading="Items" className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint [&_[cmdk-group-items]]:mt-1.5">
            {visibleItems.map((item) => {
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
