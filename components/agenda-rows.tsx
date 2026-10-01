"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarClock,
  Check,
  ChevronDown,
  Clock,
  FileText,
  ListTodo,
  MoreHorizontal,
  PanelRightOpen,
  Tag,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useCategoriesById } from "@/lib/card-chrome";
import { classMeetingTitle } from "@/lib/class-schedule";
import { dayKey, formatTime, isOverdue, toDateInputValue } from "@/lib/date-utils";
import { dayDelta, shiftedByDays } from "@/lib/calendar-drag-math";
import { applyBatchPatch, setStatusWithUndo, STATUS_LABEL } from "@/lib/item-actions";
import { handleItemMenuKey, itemMenuProps, openItemMenuAt } from "@/lib/item-menu";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Category, Item, ItemStatus } from "@/lib/types";

export interface AgendaRowSection {
  id: string;
  label: string;
  tone: "warn" | "faint";
  items: Item[];
  /** The day the section is for — a multi-day event moves from there. */
  dayKey?: string;
}

const GRID =
  "grid items-center grid-cols-[2.25rem_minmax(0,1fr)_8.75rem_8.5rem] lg:grid-cols-[2.25rem_minmax(0,1fr)_minmax(0,10rem)_9.5rem_8.75rem]";

const STATUSES: ItemStatus[] = ["todo", "doing", "done"];

/**
 * The agenda as a compact table: one line per item with aligned class, due
 * date and status. Status and date edit in place; tick rows (shift-click for a
 * range) to change many at once.
 */
export function AgendaRows({ sections }: { sections: AgendaRowSection[] }) {
  const categories = useCategoriesById();
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);

  const ordered = useMemo(() => sections.flatMap((s) => s.items.map((i) => i.id)), [sections]);
  const byId = useMemo(() => new Map(sections.flatMap((s) => s.items).map((i) => [i.id, i])), [sections]);
  // Anything that left the list (filtered, completed and hidden, deleted)
  // quietly drops out of the selection.
  const selectedItems = useMemo(
    () => ordered.filter((id) => selected.has(id)).map((id) => byId.get(id)!),
    [ordered, selected, byId]
  );
  const count = selectedItems.length;

  function toggle(id: string, range: boolean) {
    setSelected((prev) => {
      const next = new Set([...prev].filter((x) => byId.has(x)));
      const from = anchor.current;
      if (range && from && byId.has(from) && from !== id) {
        const a = ordered.indexOf(from);
        const b = ordered.indexOf(id);
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const add = !prev.has(id);
        for (const x of ordered.slice(lo, hi + 1)) {
          if (add) next.add(x);
          else next.delete(x);
        }
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchor.current = id;
    haptic("light");
  }

  const allSelected = ordered.length > 0 && count === ordered.length;

  useEffect(() => {
    if (!count) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]') || useUIStore.getState().contextMenu) return;
      setSelected(new Set());
    };
    document.addEventListener("keydown", onKey);
    // Lift the undo toast above the batch bar while it's showing.
    document.documentElement.style.setProperty("--toast-lift", "5.75rem");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.removeProperty("--toast-lift");
    };
  }, [count]);

  return (
    <>
      <div role="table" aria-label="Agenda" className="rounded-xl border border-line bg-surface">
        <div role="rowgroup">
          <div
            role="row"
            className={cn(GRID, "rounded-t-xl border-b border-line px-1 py-1 text-[11px] font-medium uppercase tracking-wider text-ink-faint")}
          >
            <div role="columnheader" className="flex justify-center">
              <SelectBox
                checked={allSelected ? true : count > 0 ? "mixed" : false}
                visible
                label={allSelected ? "Clear selection" : "Select all"}
                onToggle={() => setSelected(allSelected ? new Set() : new Set(ordered))}
              />
            </div>
            <div role="columnheader" className="px-1">Title</div>
            <div role="columnheader" className="hidden px-2 lg:block">Class</div>
            <div role="columnheader" className="px-2">Due</div>
            <div role="columnheader" className="px-2">Status</div>
          </div>
        </div>
        {sections.map((section) => (
          <div key={section.id} role="rowgroup" id={`agenda-${section.id}`} className="agenda-day">
            <div role="row" className="border-b border-line bg-surface-sunken/40 px-3 py-1.5">
              <span
                role="rowheader"
                className={cn("text-[11.5px] font-medium", section.tone === "warn" ? "text-warn" : "text-ink-soft")}
              >
                {section.label}
              </span>
            </div>
            {section.items.map((item) => (
              <AgendaRow
                key={item.id}
                item={item}
                category={categories.get(item.categoryId)}
                dayKey={section.dayKey}
                clock24h={clock24h}
                selected={selected.has(item.id)}
                selecting={count > 0}
                onToggle={toggle}
              />
            ))}
          </div>
        ))}
      </div>
      <AnimatePresence>
        {count > 0 && <BatchBar key="batch" items={selectedItems} onClear={() => setSelected(new Set())} />}
      </AnimatePresence>
    </>
  );
}

function AgendaRow({
  item,
  category,
  dayKey: sectionDay,
  clock24h,
  selected,
  selecting,
  onToggle,
}: {
  item: Item;
  category: Category | undefined;
  dayKey?: string;
  clock24h: boolean;
  selected: boolean;
  selecting: boolean;
  onToggle: (id: string, range: boolean) => void;
}) {
  const openInspector = useUIStore((s) => s.openInspector);
  const work = item.type !== "event";
  const status = item.status ?? "todo";
  const overdue = work && status !== "done" && isOverdue(item);
  const at = new Date(item.at);
  const menuDay = sectionDay ?? dayKey(at);
  const Glyph = item.type === "event" ? Clock : item.type === "assignment" ? FileText : ListTodo;
  const displayTitle = classMeetingTitle(item, category);

  return (
    <div
      role="row"
      aria-selected={selected}
      {...itemMenuProps(item.id, menuDay)}
      onDoubleClick={(e) => {
        if (!(e.target as HTMLElement).closest("button")) openInspector(item.id);
      }}
      className={cn(
        GRID,
        "group/row min-h-11 border-b border-line/70 px-1 text-[13px] last:border-b-0",
        "transition-colors duration-[var(--motion-micro)]",
        selected ? "bg-accent-soft/70" : "hover:bg-surface-sunken/40"
      )}
    >
      <div role="cell" className="flex justify-center">
        <SelectBox
          checked={selected}
          visible={selecting}
          label={`Select ${displayTitle}`}
          onToggle={(range) => onToggle(item.id, range)}
        />
      </div>

      <div role="cell" className="relative flex min-w-0 items-center gap-2 px-1">
        <Glyph aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => openInspector(item.id)}
            onKeyDown={(e) => handleItemMenuKey(e, item.id, menuDay)}
            className={cn(
              "block max-w-full truncate rounded text-left font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              status === "done" && work ? "text-ink-soft line-through decoration-ink-faint" : "text-ink"
            )}
          >
            {displayTitle}
          </button>
          <p className="truncate text-[11.5px] text-ink-faint lg:hidden">{category?.name ?? "No class"}</p>
        </div>
        <div className="pointer-events-none flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-[var(--motion-micro)] group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100">
          <RowIconButton label="Open details" onClick={() => openInspector(item.id)}>
            <PanelRightOpen className="h-3.5 w-3.5" strokeWidth={1.9} />
          </RowIconButton>
          <RowIconButton label="More actions" onClick={(el) => openItemMenuAt(el, item.id, { dayKey: menuDay })}>
            <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.9} />
          </RowIconButton>
        </div>
      </div>

      <div role="cell" className="hidden min-w-0 items-center gap-2 px-2 lg:flex">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: category?.color ?? "#8a8a94" }} />
        <span className="truncate text-ink-soft">{category?.name ?? "No class"}</span>
      </div>

      <div role="cell" className="min-w-0 px-1">
        <button
          type="button"
          aria-haspopup="menu"
          aria-label={`${work ? "Due" : "When"}: ${format(at, "EEEE, MMMM d")}. Change date`}
          onClick={(e) => openItemMenuAt(e.currentTarget, item.id, { dayKey: menuDay, section: "reschedule" })}
          className={cn(
            "flex h-8 max-w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[12.5px] tabular-nums transition-colors duration-[var(--motion-micro)] hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            overdue ? "font-medium text-warn" : "text-ink-soft"
          )}
        >
          <span className="truncate">
            {format(at, "EEE, MMM d")}
            {!item.allDay && <span className="text-ink-faint"> · {formatTime(item.at, clock24h)}</span>}
          </span>
        </button>
      </div>

      <div role="cell" className="px-1">
        {work ? (
          <StatusPicker item={item} />
        ) : (
          <span className="px-1.5 text-[12px] tabular-nums text-ink-faint">
            {item.allDay
              ? "All day"
              : `${formatTime(item.at, clock24h)}${item.endAt ? `–${formatTime(item.endAt, clock24h)}` : ""}`}
          </span>
        )}
      </div>
    </div>
  );
}

function RowIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: (el: HTMLButtonElement) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => onClick(e.currentTarget)}
      className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
    </button>
  );
}

function SelectBox({
  checked,
  visible,
  label,
  onToggle,
}: {
  checked: boolean | "mixed";
  visible: boolean;
  label: string;
  onToggle: (range: boolean) => void;
}) {
  const on = checked !== false;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onMouseDown={(e) => {
        // Shift-click selects a range, not the page's text.
        if (e.shiftKey) e.preventDefault();
      }}
      onClick={(e) => onToggle(e.shiftKey)}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md transition-opacity duration-[var(--motion-micro)]",
        "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        on || visible ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"
      )}
    >
      <span
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded-[4px] border transition-[background-color,border-color] duration-[var(--motion-standard)]",
          on ? "border-accent bg-accent" : "border-line-strong bg-surface"
        )}
      >
        <motion.span
          initial={false}
          animate={{ scale: on ? 1 : 0, opacity: on ? 1 : 0 }}
          transition={motionTokens.springSnappy}
          className="flex"
        >
          {checked === "mixed" ? (
            <span className="h-[2px] w-2 rounded-full bg-accent-ink" />
          ) : (
            <Check className="h-3 w-3 text-accent-ink" strokeWidth={3} />
          )}
        </motion.span>
      </span>
    </button>
  );
}

const STATUS_PILL: Record<ItemStatus, string> = {
  todo: "border-line bg-surface text-ink-soft hover:border-line-strong",
  doing: "border-accent/40 bg-accent-soft text-accent",
  done: "border-good/40 bg-good-soft text-good",
};

function StatusGlyph({ status }: { status: ItemStatus }) {
  return (
    <motion.span
      key={status}
      aria-hidden
      initial={{ scale: 0.5, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={motionTokens.springSnappy}
      className="flex h-3 w-3 shrink-0 items-center justify-center"
    >
      {status === "done" ? (
        <Check className="h-3 w-3" strokeWidth={3} />
      ) : status === "doing" ? (
        <span className="status-doing-ring h-2.5 w-2.5 rounded-full border-[1.5px] border-current bg-[color-mix(in_srgb,currentColor_35%,transparent)]" />
      ) : (
        <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-current" />
      )}
    </motion.span>
  );
}

const STATUS_MENU_WIDTH = 160;
/** Three options at min-h-8 plus the list's padding and border. */
const STATUS_MENU_HEIGHT = 3 * 32 + 10;
const MENU_EDGE = 8;

/**
 * Where the menu goes, in viewport coordinates. It lives in a portal because
 * the rows sit in a clipping container — anchored inside it, a row near the
 * bottom (or right) edge cut the menu off. Opens upward when there's no room
 * below, and stays inside the window horizontally.
 */
function statusMenuPlacement(anchor: DOMRect) {
  const below = window.innerHeight - anchor.bottom;
  const up = below < STATUS_MENU_HEIGHT + MENU_EDGE && anchor.top > below;
  const left = Math.max(
    MENU_EDGE,
    Math.min(anchor.left, window.innerWidth - STATUS_MENU_WIDTH - MENU_EDGE)
  );
  return up
    ? { left, bottom: window.innerHeight - anchor.top + 4, up }
    : { left, top: anchor.bottom + 4, up };
}

/** Status as an inline pill that opens a three-way choice. */
function StatusPicker({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<ReturnType<typeof statusMenuPlacement> | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const status = item.status ?? "todo";

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const anchor = buttonRef.current?.getBoundingClientRect();
      if (anchor) setPlace(statusMenuPlacement(anchor));
    };
    update();
    // A fixed menu doesn't follow its row, so close it once the page scrolls
    // out from under it (but not when the scroll is inside the menu itself).
    const onScroll = (e: Event) => {
      if (listRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, place]);

  function choose(next: ItemStatus) {
    haptic(next === "done" ? "success" : "light");
    setStatusWithUndo(item, next);
    setOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <div ref={ref} className="relative" data-no-shortcuts>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Status: ${STATUS_LABEL[status]}. Change status`}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium",
          "transition-[background-color,border-color,color] duration-[var(--motion-standard)] ease-[var(--ease-standard)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          STATUS_PILL[status]
        )}
      >
        <StatusGlyph status={status} />
        <span className="whitespace-nowrap">{STATUS_LABEL[status]}</span>
        <ChevronDown className="h-3 w-3 opacity-60" strokeWidth={2.25} />
      </button>
      {typeof document !== "undefined" && createPortal(
      <AnimatePresence>
        {open && place && (
          <motion.ul
            ref={listRef}
            role="listbox"
            aria-label="Status"
            data-no-shortcuts
            initial={{ opacity: 0, scale: 0.96, y: place.up ? 4 : -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: motionTokens.exit, ease: motionTokens.easeIn } }}
            transition={motionTokens.springSnappy}
            style={{
              left: place.left,
              top: place.top,
              bottom: place.bottom,
              width: STATUS_MENU_WIDTH,
              transformOrigin: place.up ? "bottom left" : "top left",
            }}
            onKeyDown={(e) => {
              const options = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
              const index = options.indexOf(document.activeElement as HTMLElement);
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                buttonRef.current?.focus();
              } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                options[(index + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.focus();
              } else if (e.key === "Tab") {
                setOpen(false);
              }
            }}
            className="fixed z-[70] rounded-lg border border-line bg-surface p-1 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.3)]"
          >
            {STATUSES.map((s) => (
              <li
                key={s}
                role="option"
                aria-selected={s === status}
                tabIndex={-1}
                onClick={() => choose(s)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    choose(s);
                  }
                }}
                className={cn(
                  "flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[12.5px] outline-none transition-colors duration-[var(--motion-micro)] hover:bg-surface-sunken focus:bg-surface-sunken",
                  s === "doing" ? "text-accent" : s === "done" ? "text-good" : "text-ink-soft"
                )}
              >
                <StatusGlyph status={s} />
                <span className="flex-1 text-ink">{STATUS_LABEL[s]}</span>
                {s === status && <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.5} />}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>,
      document.body
      )}
    </div>
  );
}

type BatchMenu = "move" | "class" | "date" | null;

/** Change many selected items at once — one Undo for the lot. */
function BatchBar({ items, onClear }: { items: Item[]; onClear: () => void }) {
  const categories = useDatebookStore((s) => s.categories);
  const [menu, setMenu] = useState<BatchMenu>(null);
  const [date, setDate] = useState(() => toDateInputValue(items[0]?.at ?? new Date().toISOString()));
  const ref = useRef<HTMLDivElement>(null);
  const work = items.filter((i) => i.type !== "event");
  const count = items.length;
  const plural = (n: number) => `${n} item${n === 1 ? "" : "s"}`;

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [menu]);

  function setStatus(status: ItemStatus) {
    haptic(status === "done" ? "success" : "light");
    applyBatchPatch(
      work,
      (i) => ((i.status ?? "todo") === status ? null : { status }),
      (n) => `${plural(n)} marked ${STATUS_LABEL[status].toLowerCase()}`
    );
  }

  function shift(days: number) {
    haptic("light");
    applyBatchPatch(items, (i) => shiftedByDays(i, days), (n) => `Moved ${plural(n)}`);
    setMenu(null);
  }

  function moveTo(key: string) {
    haptic("light");
    applyBatchPatch(
      items,
      (i) => {
        const days = dayDelta(dayKey(new Date(i.at)), key);
        return days ? shiftedByDays(i, days) : null;
      },
      (n) => `Moved ${plural(n)} to ${format(new Date(`${key}T12:00:00`), "EEE, MMM d")}`
    );
    setMenu(null);
  }

  function setClass(category: Category) {
    haptic("light");
    applyBatchPatch(
      items,
      (i) => (i.categoryId === category.id ? null : { categoryId: category.id }),
      (n) => `Moved ${plural(n)} to ${category.name}`
    );
    setMenu(null);
  }

  const barButton =
    "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium text-ink-soft transition-colors duration-[var(--motion-micro)] hover:bg-surface-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

  return (
    <motion.div
      ref={ref}
      role="toolbar"
      aria-label={`${plural(count)} selected`}
      data-no-shortcuts
      initial={{ opacity: 0, y: 20, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.97, transition: { duration: motionTokens.exit, ease: motionTokens.easeIn } }}
      transition={motionTokens.spring}
      onKeyDown={(e) => {
        if (e.key === "Escape" && menu) {
          e.preventDefault();
          e.stopPropagation();
          setMenu(null);
        }
      }}
      className="fixed bottom-6 left-1/2 z-[43] flex -translate-x-1/2 items-center gap-1 rounded-xl border border-line bg-surface p-1.5 shadow-[0_18px_44px_-16px_rgb(0_0_0/0.4)]"
    >
      <button type="button" onClick={onClear} aria-label="Clear selection" title="Clear selection (Esc)" className={cn(barButton, "w-8 justify-center px-0")}>
        <X className="h-4 w-4" strokeWidth={2} />
      </button>
      <span className="whitespace-nowrap pl-0.5 pr-2 text-[12.5px] font-semibold tabular-nums text-ink" aria-live="polite">
        {count} selected
      </span>
      <span aria-hidden className="h-5 w-px bg-line" />

      <div role="group" aria-label="Set status" className="flex items-center gap-0.5">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={work.length === 0}
            onClick={() => setStatus(s)}
            title={work.length === 0 ? "Events don't have a status" : undefined}
            className={cn(barButton, s === "doing" && "hover:text-accent", s === "done" && "hover:text-good")}
          >
            <StatusGlyph status={s} />
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      <span aria-hidden className="h-5 w-px bg-line" />

      <div className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menu === "move" || menu === "date"}
          onClick={() => setMenu(menu === "move" || menu === "date" ? null : "move")}
          className={barButton}
        >
          <CalendarClock className="h-3.5 w-3.5" strokeWidth={1.9} />
          Move
          <ChevronDown className="h-3 w-3 opacity-60" strokeWidth={2.25} />
        </button>
        <AnimatePresence>
          {(menu === "move" || menu === "date") && (
            <BatchPopover key="move">
              {menu === "move" ? (
                <>
                  <PopoverItem onClick={() => shift(1)}>A day later</PopoverItem>
                  <PopoverItem onClick={() => shift(7)}>A week later</PopoverItem>
                  <PopoverItem onClick={() => shift(-1)}>A day earlier</PopoverItem>
                  <div role="separator" className="mx-2 my-1 h-px bg-line" />
                  <PopoverItem onClick={() => setMenu("date")}>Pick a date…</PopoverItem>
                </>
              ) : (
                <form
                  className="flex flex-col gap-2 p-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (date) moveTo(date);
                  }}
                >
                  <p className="text-[11.5px] text-ink-faint">Each keeps its own time of day.</p>
                  <input
                    type="date"
                    value={date}
                    autoFocus
                    onChange={(e) => setDate(e.target.value)}
                    aria-label="Move selected items to"
                    className="field-control min-h-9 w-full rounded-md border border-line bg-surface px-2 text-[13px] text-ink focus:border-accent focus:outline-none focus:shadow-[0_0_0_3px_var(--accent-soft)]"
                  />
                  <button
                    type="submit"
                    disabled={!date}
                    className="min-h-9 rounded-md bg-accent px-3 text-[12.5px] font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    Move {plural(count)}
                  </button>
                </form>
              )}
            </BatchPopover>
          )}
        </AnimatePresence>
      </div>

      <div className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menu === "class"}
          onClick={() => setMenu(menu === "class" ? null : "class")}
          className={barButton}
        >
          <Tag className="h-3.5 w-3.5" strokeWidth={1.9} />
          Class
          <ChevronDown className="h-3 w-3 opacity-60" strokeWidth={2.25} />
        </button>
        <AnimatePresence>
          {menu === "class" && (
            <BatchPopover key="class">
              <div className="max-h-64 overflow-y-auto">
                {categories
                  .filter((c) => !c.archived)
                  .map((c) => (
                    <PopoverItem key={c.id} onClick={() => setClass(c)}>
                      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color }} />
                      <span className="truncate">{c.name}</span>
                    </PopoverItem>
                  ))}
              </div>
            </BatchPopover>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function BatchPopover({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      role="menu"
      initial={{ opacity: 0, scale: 0.96, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: 4, transition: { duration: motionTokens.exit, ease: motionTokens.easeIn } }}
      transition={motionTokens.springSnappy}
      style={{ transformOrigin: "bottom left" }}
      className="absolute bottom-[calc(100%+10px)] left-0 w-56 rounded-xl border border-line bg-surface p-1 shadow-[0_16px_40px_-14px_rgb(0_0_0/0.35)]"
    >
      {children}
    </motion.div>
  );
}

function PopoverItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] text-ink outline-none transition-colors duration-[var(--motion-micro)] hover:bg-surface-sunken focus-visible:bg-surface-sunken"
    >
      {children}
    </button>
  );
}
