"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, MapPin } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { formatTime, isOverdue } from "@/lib/date-utils";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens, prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Category, Item, ItemStatus } from "@/lib/types";
import { ItemEditor } from "@/components/item-editor";

function useClock24h() {
  return useDatebookStore((s) => s.settings.clock24h);
}

/**
 * Leaving a list — deleted, filtered out, or hidden by "hide completed".
 *
 * The card shrinks its own height as it fades, so the rows below close the gap
 * on the same beat instead of jumping up the moment it unmounts. Only takes
 * effect inside an `<AnimatePresence>`; elsewhere it is inert.
 */
const CARD_EXIT = {
  opacity: 0,
  scale: 0.97,
  height: 0,
  marginTop: 0,
  marginBottom: 0,
  transition: { duration: motionTokens.exit, ease: motionTokens.easeIn },
};

export function ItemCard({ item, category }: { item: Item; category: Category | undefined }) {
  return item.type === "event" ? (
    <EventCard item={item} category={category} />
  ) : (
    <AssignmentCard item={item} category={category} />
  );
}

/* ------------------------------------------------------------------ */
/* Status controls                                                     */
/* ------------------------------------------------------------------ */

function CompleteButton({
  status,
  color,
  onToggle,
}: {
  status: ItemStatus;
  color: string;
  onToggle: () => void;
}) {
  const done = status === "done";
  const prevDone = useRef(done);
  // Bumped on each arrival at "done" so the ring replays its entrance.
  const [burst, setBurst] = useState(0);

  useEffect(() => {
    if (done && !prevDone.current) setBurst((n) => n + 1);
    prevDone.current = done;
  }, [done]);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        haptic(done ? "light" : "success");
        onToggle();
      }}
      aria-label={done ? "Mark to do" : "Mark complete"}
      title={done ? "Mark to do" : "Mark complete"}
      style={{ "--cat": color } as React.CSSProperties}
      className="press-none group/status flex h-11 w-11 shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
    >
      <span className="relative flex h-5 w-5 items-center justify-center">
        {/* One quiet ring travelling outward on completion — the only celebratory
            beat in the app, and it is over in half a second. */}
        {burst > 0 && (
          <span
            key={burst}
            aria-hidden
            className="complete-ripple pointer-events-none absolute inset-0 rounded-full border-2 border-good"
          />
        )}
        <motion.span
          // A dip on press, so the tap registers even when the colour change is
          // subtle. The disc still renders all three states: "in progress" is
          // set from the editor's segmented control, and has to stay legible
          // here even though this button only toggles done.
          whileTap={{ scale: 0.82 }}
          transition={motionTokens.springSnappy}
          className={cn(
            "relative flex h-5 w-5 items-center justify-center rounded-full border-2",
            "transition-[background-color,border-color] duration-[var(--motion-standard)] ease-[var(--ease-standard)]",
            status === "todo" &&
              "border-[color-mix(in_srgb,var(--cat)_55%,transparent)] bg-transparent group-hover/status:border-[color-mix(in_srgb,var(--cat)_90%,transparent)]",
            status === "doing" &&
              "status-doing-ring border-accent bg-[conic-gradient(from_200deg,var(--accent)_0deg,var(--accent)_180deg,transparent_180deg)]",
            status === "done" && "border-good bg-good"
          )}
        >
          <AnimatePresence initial={false}>
            {status === "done" && (
              <motion.span
                key="check"
                initial={{ scale: 0, opacity: 0, rotate: -25 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={motionTokens.springSnappy}
                className="flex items-center justify-center"
              >
                {/* `--accent-ink` tracks the theme: white on the light presets,
                    near-black on the dark ones, where `--good` is a pale mint and
                    a hardcoded white tick was all but invisible. */}
                <Check className="h-3 w-3 text-[var(--accent-ink)]" strokeWidth={3.25} />
              </motion.span>
            )}
          </AnimatePresence>
        </motion.span>
      </span>
    </button>
  );
}

function StatusSegmented({
  value,
  onChange,
  layoutScope,
}: {
  value: ItemStatus;
  onChange: (status: ItemStatus) => void;
  layoutScope: string;
}) {
  const options: { value: ItemStatus; label: string }[] = [
    { value: "todo", label: "To do" },
    { value: "doing", label: "In progress" },
    { value: "done", label: "Done" },
  ];

  return (
    <div
      className="flex w-full items-center gap-0.5 rounded-lg border border-line bg-surface-sunken p-0.5"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              haptic(opt.value === "done" ? "success" : "light");
              onChange(opt.value);
            }}
            aria-pressed={active}
            className={cn(
              "press-none relative min-h-9 flex-1 rounded-md px-2 text-[12px] font-medium",
              "transition-colors duration-[var(--motion-standard)]",
              active ? "text-accent-ink" : "text-ink-soft hover:text-ink"
            )}
          >
            {active && (
              <motion.span
                layoutId={`item-status-pill-${layoutScope}`}
                className="absolute inset-0 rounded-md bg-accent"
                transition={motionTokens.spring}
              />
            )}
            <span className="relative z-[1]">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared expand/collapse detail panel                                 */
/* ------------------------------------------------------------------ */

function ItemDetails({
  item,
  category,
  clock24h,
  onCollapse,
}: {
  item: Item;
  category: Category | undefined;
  clock24h: boolean;
  onCollapse: () => void;
}) {
  return (
    <ItemEditor
      item={item}
      category={category}
      clock24h={clock24h}
      StatusSegmented={StatusSegmented}
      onCollapse={onCollapse}
    />
  );
}

function useExpandable(itemId: string) {
  const focusedItemId = useUIStore((s) => s.focusedItemId);
  const setFocusedItemId = useUIStore((s) => s.setFocusedItemId);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (focusedItemId === itemId) {
      setExpanded(true);
      setFocusedItemId(null);
    }
  }, [focusedItemId, itemId, setFocusedItemId]);

  const toggle = () => {
    haptic("light");
    setExpanded((v) => !v);
  };
  const collapse = () => setExpanded(false);
  const keyToggle = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
      return;
    }
    // Esc closes the card you are in before it reaches any surrounding sheet.
    if (e.key === "Escape" && expanded) {
      e.preventDefault();
      e.stopPropagation();
      setExpanded(false);
    }
  };
  return { expanded, toggle, collapse, keyToggle };
}

/**
 * Animates its own height rather than leaning on the card's `layout` prop.
 *
 * The previous version paired a 120ms `layout` transition on the card with a
 * 200ms opacity/y fade on the content: the card finished shrinking while the
 * editor was still fully visible, so on collapse the form spilled over the row
 * below for the remaining ~80ms. Owning the height here puts the container and
 * its contents on one animation, and `overflow-hidden` guarantees nothing
 * escapes the card while it closes.
 */
function ExpandPanel({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="panel"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{
            height: motionTokens.springLayout,
            // Content fades in behind the opening edge and out ahead of the
            // closing one, so a half-height form is never at full opacity.
            opacity: { duration: motionTokens.micro, ease: motionTokens.easeInOut },
          }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function useCompleteStyle(done: boolean) {
  const [styled, setStyled] = useState(done);

  useEffect(() => {
    if (!done) {
      setStyled(false);
      return;
    }
    if (prefersReducedMotion()) {
      setStyled(true);
      return;
    }
    // Let the tick land before the row dims and strikes through, so the two read
    // as cause and effect rather than one muddled change.
    const delayMs = Math.round(motionTokens.standard * 1000);
    const t = window.setTimeout(() => setStyled(true), delayMs);
    return () => window.clearTimeout(t);
  }, [done]);

  return styled;
}

/** The chevron is the only persistent "this opens" cue, so it gets a spring. */
function ExpandChevron({ expanded }: { expanded: boolean }) {
  return (
    <motion.span
      aria-hidden
      animate={{ rotate: expanded ? 180 : 0 }}
      transition={motionTokens.spring}
      className="flex h-4 w-4 shrink-0 items-center justify-center text-ink-faint"
    >
      <ChevronDown className="h-4 w-4" strokeWidth={1.9} />
    </motion.span>
  );
}

/**
 * The two-line preview has to go the instant the panel opens — otherwise it and
 * the editor's own Details field show the same text twice. Collapsing its height
 * rather than dropping it keeps the header from jumping.
 */
function CollapsedDescription({ show, text }: { show: boolean; text?: string }) {
  if (!text) return null;
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.p
          key="desc"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: motionTokens.micro, ease: motionTokens.easeInOut }}
          className="mt-1 overflow-hidden whitespace-pre-line text-[11.5px] leading-snug text-ink-faint line-clamp-2"
        >
          {text}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/* Event                                                               */
/* ------------------------------------------------------------------ */

export function EventCard({ item, category }: { item: Item; category: Category | undefined }) {
  const clock24h = useClock24h();
  const showLocation = useDatebookStore((s) => s.settings.showLocation);
  const color = category?.color ?? "#8a8a94";
  const { expanded, toggle, collapse, keyToggle } = useExpandable(item.id);

  return (
    <motion.div
      // `layout="position"` (not full `layout`) so siblings glide to their new
      // offsets without framer also trying to scale this card's own box — which
      // fought the height animation inside it and produced a visible squash.
      layout="position"
      exit={CARD_EXIT}
      transition={motionTokens.springLayout}
      style={{ "--cat": color } as React.CSSProperties}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={toggle}
      onKeyDown={keyToggle}
      className={cn(
        "press-none press-surface cat-surface cursor-pointer overflow-hidden rounded-lg px-[var(--card-pad-x)] py-[var(--card-pad-y)]",
        "shadow-[var(--shadow-sm)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        expanded && "shadow-[var(--shadow-md)]"
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex w-[74px] shrink-0 flex-col leading-tight">
          <span className="text-[13px] font-semibold tabular-nums cat-text">
            {item.allDay ? "All day" : formatTime(item.at, clock24h)}
          </span>
          {!item.allDay && item.endAt && (
            <span className="text-[11px] tabular-nums text-ink-faint">
              {formatTime(item.endAt, clock24h)}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 break-words text-[14px] font-medium text-ink">{item.title}</p>
          {showLocation && item.location && (
            <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-ink-soft">
              <MapPin className="h-3 w-3 shrink-0" strokeWidth={1.75} />
              {item.location}
            </p>
          )}
          <CollapsedDescription show={!expanded} text={item.description} />
        </div>
        <ExpandChevron expanded={expanded} />
      </div>

      <ExpandPanel open={expanded}>
        <ItemDetails item={item} category={category} clock24h={clock24h} onCollapse={collapse} />
      </ExpandPanel>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Assignment / task                                                   */
/* ------------------------------------------------------------------ */

export function AssignmentCard({ item, category }: { item: Item; category: Category | undefined }) {
  const clock24h = useClock24h();
  const toggleItemDone = useDatebookStore((s) => s.toggleItemDone);
  const showCategoryDot = useDatebookStore((s) => s.settings.showCategoryDot);
  const color = category?.color ?? "#8a8a94";
  const status = item.status ?? "todo";
  const done = status === "done";
  const overdue = isOverdue(item);
  const showCompleteStyle = useCompleteStyle(done);
  const { expanded, toggle, collapse, keyToggle } = useExpandable(item.id);

  return (
    <motion.div
      layout="position"
      exit={CARD_EXIT}
      transition={motionTokens.springLayout}
      animate={{ opacity: showCompleteStyle ? 0.62 : 1 }}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={toggle}
      onKeyDown={keyToggle}
      className={cn(
        "press-none press-surface cursor-pointer overflow-hidden rounded-lg border border-line bg-surface",
        "px-[var(--card-pad-x)] py-[var(--card-pad-y)] shadow-[var(--shadow-sm)]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        expanded && "border-line-strong shadow-[var(--shadow-md)]",
        // An overdue row earns a warning edge. Previously the only signal was one
        // word in 12px text, which scrolled past unnoticed in a long list.
        overdue && !done && "border-l-[3px] border-l-warn"
      )}
    >
      <div className="flex items-center gap-1">
        <CompleteButton
          status={status}
          color={color}
          onToggle={() => toggleItemDone(item.id)}
        />

        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "relative line-clamp-2 w-fit max-w-full break-words text-[14px] font-medium",
              "transition-colors duration-[var(--motion-standard)]",
              showCompleteStyle ? "text-ink-soft" : "text-ink"
            )}
          >
            {item.title}
            {/* A strike-through that draws itself left to right, instead of the
                whole line appearing in one frame. */}
            <motion.span
              aria-hidden
              initial={false}
              animate={{ scaleX: showCompleteStyle ? 1 : 0 }}
              transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
              style={{ transformOrigin: "left center" }}
              className="pointer-events-none absolute inset-x-0 top-1/2 h-[1.5px] rounded-full bg-current"
            />
          </p>
          <p
            className={cn(
              "mt-0.5 truncate text-[12px] transition-colors duration-[var(--motion-standard)]",
              overdue && !done ? "font-medium text-warn" : "text-ink-soft"
            )}
          >
            {item.allDay ? "All day" : formatTime(item.at, clock24h)}
            {overdue && !done && " · overdue"}
            {status === "doing" && !overdue && " · in progress"}
            {done && " · done"}
          </p>
          <CollapsedDescription show={!expanded} text={item.description} />
        </div>

        {showCategoryDot && (
          <motion.span
            initial={false}
            animate={{ opacity: expanded ? 0 : 1, scale: expanded ? 0.5 : 1 }}
            transition={{ duration: motionTokens.micro, ease: motionTokens.ease }}
            style={{ "--cat": color } as React.CSSProperties}
            className="cat-dot h-1.5 w-1.5 shrink-0 rounded-full"
          />
        )}
        <ExpandChevron expanded={expanded} />
      </div>

      <ExpandPanel open={expanded}>
        <ItemDetails item={item} category={category} clock24h={clock24h} onCollapse={collapse} />
      </ExpandPanel>
    </motion.div>
  );
}
