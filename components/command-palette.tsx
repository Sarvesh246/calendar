"use client";

import { useEffect } from "react";
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
import { useScrollLock } from "@/lib/use-scroll-lock";

export function CommandPalette() {
  const router = useRouter();
  const open = useUIStore((s) => s.commandPaletteOpen);
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const setAIDrawerOpen = useUIStore((s) => s.setAIDrawerOpen);
  const setQuickAddPrefill = useUIStore((s) => s.setQuickAddPrefill);
  const items = useDatebookStore((s) => s.items);
  const categories = useDatebookStore((s) => s.categories);

  useScrollLock(open);

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
    setOpen(false);
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      overlayClassName="fixed inset-0 z-50 bg-black/25 backdrop-blur-[2px]"
      className="glass fixed left-1/2 top-[18vh] z-50 w-[92vw] max-w-[560px] -translate-x-1/2 overflow-hidden rounded-xl"
    >
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <Sparkles className="h-4 w-4 shrink-0 text-ink-faint" strokeWidth={1.75} />
        <Command.Input
          autoFocus
          placeholder="Search Datebook…"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-faint focus:outline-none"
        />
        <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
          esc
        </kbd>
      </div>

      <Command.List
        // Shrink to fit above the on-screen keyboard so results aren't hidden.
        style={{ maxHeight: "max(140px, calc(60vh - var(--keyboard-inset, 0px)))" }}
        className="overflow-y-auto p-2"
      >
        <Command.Empty className="px-3 py-6 text-center text-[13px] text-ink-faint">
          No results.
        </Command.Empty>

        <Command.Group heading="Create" className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint [&_[cmdk-group-items]]:mt-1.5">
          <Command.Item onSelect={createNew} className="cmdk-row">
            <Plus className="h-4 w-4" strokeWidth={1.75} /> New item
          </Command.Item>
        </Command.Group>

        <Command.Group heading="Navigate" className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint [&_[cmdk-group-items]]:mt-1.5">
          <Command.Item onSelect={() => go("/today")} className="cmdk-row">
            <Sun className="h-4 w-4" strokeWidth={1.75} /> Today
          </Command.Item>
          <Command.Item onSelect={() => go("/calendar")} className="cmdk-row">
            <CalendarDays className="h-4 w-4" strokeWidth={1.75} /> Calendar
          </Command.Item>
          <Command.Item onSelect={() => go("/agenda")} className="cmdk-row">
            <ListChecks className="h-4 w-4" strokeWidth={1.75} /> Agenda
          </Command.Item>
        </Command.Group>

        <Command.Group heading="Actions" className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint [&_[cmdk-group-items]]:mt-1.5">
          <Command.Item
            onSelect={() => {
              setAIDrawerOpen(true);
              setOpen(false);
            }}
            className="cmdk-row"
          >
            <Sparkles className="h-4 w-4" strokeWidth={1.75} /> Ask Gemini
          </Command.Item>
          <Command.Item
            onSelect={() => {
              setAIDrawerOpen(true);
              setOpen(false);
            }}
            className="cmdk-row"
          >
            <Upload className="h-4 w-4" strokeWidth={1.75} /> Import syllabus
          </Command.Item>
          <Command.Item onSelect={() => go("/settings")} className="cmdk-row">
            <Settings className="h-4 w-4" strokeWidth={1.75} /> Settings
          </Command.Item>
        </Command.Group>

        {items.length > 0 && (
          <Command.Group heading="Items" className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint [&_[cmdk-group-items]]:mt-1.5">
            {items.slice(0, 30).map((item) => {
              const category = categories.find((c) => c.id === item.categoryId);
              return (
                <Command.Item key={item.id} value={item.title} onSelect={() => go("/agenda")} className="cmdk-row">
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
    </Command.Dialog>
  );
}
