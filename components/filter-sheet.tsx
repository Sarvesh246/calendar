"use client";

import { startTransition, useRef, useState } from "react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { Check, SlidersHorizontal, X } from "lucide-react";
import { summariseFilters } from "@/lib/filter-summary";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";
import { haptic } from "@/lib/haptic";
import { SHEET_DRAG, shouldDismissSheet, startSheetDrag, useSheetOverscroll } from "@/lib/sheet-gesture";
import { Scrim } from "@/components/ui/scrim";
import { SheetHandle } from "@/components/sheet-handle";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { viewSummary } from "@/lib/views";
import { useAllViews } from "@/components/saved-views";

export function FilterButton({ className }: { className?: string }) {
  const filter = useUIStore((s) => s.categoryFilter);
  const categories = useDatebookStore((s) => s.categories);
  const hideCompleted = useDatebookStore((s) => s.settings.hideCompleted);
  const activeViewId = useUIStore((s) => s.activeViewId);
  const setFilterOpen = useUIStore((s) => s.setFilterOpen);
  const views = useAllViews();
  const summary = summariseFilters(
    categories,
    filter,
    hideCompleted,
    views.find((v) => v.id === activeViewId)?.name
  );
  const active = summary.active;

  return (
    <Button
      variant="secondary"
      size="icon"
      onClick={() => {
        haptic("light");
        setFilterOpen(true);
      }}
      aria-label={active ? `Filters — ${summary.label}. Change filters` : "Filter"}
      className={cn("relative", className, active && "max-md:bg-accent-soft max-md:text-accent max-md:ring-1 max-md:ring-accent")}
    >
      <SlidersHorizontal className="h-4 w-4" strokeWidth={1.9} />
      {/* The "filters are on" dot springs in rather than blinking, so the state
          change registers even though it's a 8px mark in the corner. */}
      <AnimatePresence initial={false}>
        {active && (
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
  );
}

export function FilterSheet() {
  const open = useUIStore((s) => s.filterOpen);
  const setOpen = useUIStore((s) => s.setFilterOpen);
  useLockBodyScroll(open);

  return (
    <AnimatePresence>
      {open && <FilterSheetBody onClose={() => setOpen(false)} />}
    </AnimatePresence>
  );
}

function FilterSheetBody({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();
  const [dragging, setDragging] = useState(false);
  useDialogFocus(panelRef, true);
  useSheetOverscroll(scrollRef, dragControls);
  const categories = useDatebookStore((s) => s.categories);
  const hideCompleted = useDatebookStore((s) => s.settings.hideCompleted);
  const updateSettings = useDatebookStore((s) => s.updateSettings);
  const filter = useUIStore((s) => s.categoryFilter);
  const toggle = useUIStore((s) => s.toggleCategoryFilter);
  const clear = useUIStore((s) => s.clearCategoryFilter);
  const activeViewId = useUIStore((s) => s.activeViewId);
  const applyView = useUIStore((s) => s.applyView);
  const views = useAllViews();
  const visible = categories.filter((c) => !c.archived);
  const summary = summariseFilters(
    categories,
    filter,
    hideCompleted,
    views.find((v) => v.id === activeViewId)?.name
  );

  return (
        <div className="viewport-pinned-overlay fixed inset-0 z-50">
          <Scrim label="Close filter" onClick={onClose} />
          <motion.div
            role="dialog"
            ref={panelRef}
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === "Escape") { event.stopPropagation(); onClose(); }
            }}
            aria-modal="true"
            aria-label="Filters"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%", transition: { duration: motionTokens.exit, ease: motionTokens.easeIn } }}
            transition={motionTokens.springGentle}
            style={{ willChange: "transform" }}
            {...SHEET_DRAG}
            dragControls={dragControls}
            onDragStart={() => setDragging(true)}
            onDragEnd={(_, info) => {
              setDragging(false);
              if (shouldDismissSheet(info)) {
                haptic("light");
                onClose();
              }
            }}
            // `mobile-action-sheet` rather than its own max-height: that class
            // is what keeps a sheet clear of the status bar, and this one was
            // measuring against the full visible viewport like the search sheet
            // used to — far enough up that its own close button was unreachable.
            className="mobile-action-sheet absolute inset-x-0 bottom-0 mx-auto flex max-h-[85dvh] flex-col rounded-t-2xl border border-line bg-surface px-4 pb-[max(var(--safe-bottom),1rem)] pt-0.5 md:bottom-6 md:max-w-[420px] md:rounded-2xl"
          >
            <SheetHandle dragControls={dragControls} dragging={dragging} />
            <div
              className="mb-3 flex cursor-grab items-center justify-between gap-2 active:cursor-grabbing"
              onPointerDown={(e) => startSheetDrag(dragControls, e)}
            >
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-ink">Filters</p>
                {/* What's on, right where you turn it off — the sheet showed
                    ticks only, which say what is selected but never that
                    anything is being hidden. */}
                <p className="truncate text-[12px] text-ink-soft">
                  {summary.active ? summary.label : "Showing everything"}
                </p>
              </div>
              <Button
                variant="tertiary"
                size="iconSm"
                onClick={onClose}
                aria-label="Close"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </Button>
            </div>
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <p className="mb-2 text-[15px] font-semibold text-ink">Views</p>
            <div className="mb-4 flex flex-col gap-1">
              {views.map((view) => {
                const active = view.id === activeViewId;
                return (
                  <FilterRow
                    key={view.id}
                    selected={active}
                    onSelect={() => {
                      haptic("light");
                      applyView(active ? null : view);
                    }}
                  >
                    {view.name}
                    <span className="block truncate text-[11.5px] text-ink-faint">{viewSummary(view)}</span>
                  </FilterRow>
                );
              })}
            </div>
            <p className="mb-2 text-[15px] font-semibold text-ink">Classes</p>
            <div className="flex flex-col gap-1">
              <FilterRow
                selected={!filter && !activeViewId}
                onSelect={() => {
                  haptic("light");
                  // A saved view set the classes *and* status/kind/range. Clearing
                  // classes alone would leave those rules quietly in force.
                  if (activeViewId) applyView(null);
                  else clear();
                  onClose();
                }}
              >
                All classes
              </FilterRow>
              {visible.map((cat) => {
                const active = filter?.includes(cat.id) ?? false;
                return (
                  <FilterRow
                    key={cat.id}
                    selected={active}
                    onSelect={() => {
                      haptic("light");
                      toggle(cat.id);
                    }}
                    dot={cat.color}
                  >
                    {cat.name}
                  </FilterRow>
                );
              })}
            </div>

            {/* "Hide completed" lived three taps deep in the overflow menu and
                emptied lists just as effectively as a class filter. It belongs
                beside the thing it behaves like. */}
            <div className="mt-3 border-t border-line pt-3">
              <FilterRow
                selected={hideCompleted}
                onSelect={() => {
                  haptic("light");
                  startTransition(() => updateSettings({ hideCompleted: !hideCompleted }));
                }}
              >
                Hide completed
              </FilterRow>
              {summary.active && (
                <button
                  type="button"
                  onClick={() => {
                    haptic("light");
                    // The view goes first: it is what set the classes, so
                    // clearing the classes alone would leave its status, kind
                    // and range filters quietly in force.
                    applyView(null);
                    startTransition(() => updateSettings({ hideCompleted: false }));
                    onClose();
                  }}
                  className="press-none mt-1 flex min-h-11 w-full items-center justify-center rounded-lg text-[13.5px] font-semibold text-accent"
                >
                  Reset all filters
                </button>
              )}
            </div>
            </div>
          </motion.div>
        </div>
  );
}

/**
 * A row in the filter sheet. Selection used to be carried by a background tint
 * alone, which is easy to miss on a plain sheet — every row now ends in a tick
 * that springs in, so you can see what's on without comparing shades.
 */
function FilterRow({
  selected,
  onSelect,
  dot,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  dot?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "press-none flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-left text-[14px]",
        "transition-colors duration-[var(--motion-standard)]",
        selected ? "bg-accent-soft text-ink" : "text-ink-soft active:bg-surface-sunken"
      )}
    >
      {dot && (
        <motion.span
          initial={false}
          animate={{ scale: selected ? 1.25 : 1 }}
          transition={motionTokens.springSnappy}
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: dot }}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <motion.span
        aria-hidden
        initial={false}
        animate={{ scale: selected ? 1 : 0, opacity: selected ? 1 : 0 }}
        transition={motionTokens.springSnappy}
        className="flex h-4 w-4 shrink-0 items-center justify-center"
      >
        <Check className="h-4 w-4 text-accent" strokeWidth={2.5} />
      </motion.span>
    </button>
  );
}
