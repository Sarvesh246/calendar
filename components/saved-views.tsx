"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bookmark, Check, Plus, X } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useWorkspacePrefs } from "@/lib/workspace-prefs";
import {
  BUILT_IN_VIEWS,
  VIEW_KINDS,
  VIEW_RANGES,
  VIEW_STATUSES,
  viewSummary,
  type SavedView,
  type ViewRange,
} from "@/lib/views";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { ItemStatus, ItemType } from "@/lib/types";

export function useAllViews(): SavedView[] {
  const saved = useWorkspacePrefs((s) => s.savedViews);
  return [...BUILT_IN_VIEWS, ...saved];
}

/** The sidebar's "Views" list: built-ins, your saved ones, and a way to save more. */
export function SidebarViews() {
  const views = useAllViews();
  const removeSavedView = useWorkspacePrefs((s) => s.removeSavedView);
  const activeId = useUIStore((s) => s.activeViewId);
  const applyView = useUIStore((s) => s.applyView);
  const [editing, setEditing] = useState(false);

  return (
    <div className="mt-6 flex flex-col gap-0.5">
      <div className="flex items-center justify-between px-2.5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">Views</p>
        <div className="flex items-center gap-1">
          {activeId && (
            <button
              type="button"
              onClick={() => applyView(null)}
              className="text-[11.5px] font-medium text-accent hover:underline"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            aria-label="Save a view"
            title="Save a view"
            className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <Plus className={cn("h-3.5 w-3.5 transition-transform duration-[var(--motion-standard)]", editing && "rotate-45")} strokeWidth={2} />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {editing && <ViewEditor key="editor" onDone={() => setEditing(false)} />}
      </AnimatePresence>

      {views.map((view) => {
        const active = view.id === activeId;
        return (
          <div key={view.id} className="group relative">
            <button
              type="button"
              onClick={() => {
                haptic("light");
                applyView(active ? null : view);
              }}
              aria-pressed={active}
              title={viewSummary(view)}
              className={cn(
                "press-none flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px]",
                "transition-colors duration-[var(--motion-standard)]",
                active ? "bg-surface-sunken text-ink" : "text-ink-soft hover:bg-surface-sunken hover:text-ink",
                !view.builtIn && "pr-7"
              )}
            >
              <motion.span
                aria-hidden
                initial={false}
                animate={{ scale: active ? 1 : 0.85 }}
                transition={motionTokens.springSnappy}
                className={cn("flex shrink-0", active ? "text-accent" : "text-ink-faint")}
              >
                <Bookmark className="h-3.5 w-3.5" strokeWidth={1.9} fill={active ? "currentColor" : "none"} />
              </motion.span>
              <span className="min-w-0 flex-1 truncate">{view.name}</span>
            </button>
            {!view.builtIn && (
              <button
                type="button"
                aria-label={`Delete view ${view.name}`}
                title="Delete view"
                onClick={() => {
                  if (active) applyView(null);
                  removeSavedView(view.id);
                }}
                className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-ink-faint opacity-0 transition-opacity hover:bg-surface hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function toggleIn<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Save what you're looking at (or a new combination) as a named view. */
export function ViewEditor({ onDone }: { onDone: () => void }) {
  const categoryFilter = useUIStore((s) => s.categoryFilter);
  const current = useUIStore((s) => s.viewFilter);
  const applyView = useUIStore((s) => s.applyView);
  const addSavedView = useWorkspacePrefs((s) => s.addSavedView);
  const categories = useDatebookStore((s) => s.categories);
  const [name, setName] = useState("");
  const [statuses, setStatuses] = useState<ItemStatus[]>(current?.statuses ?? []);
  const [kinds, setKinds] = useState<ItemType[]>(current?.kinds ?? []);
  const [range, setRange] = useState<ViewRange>(current?.range ?? "any");
  const classIds = categoryFilter ?? [];
  const [useClasses, setUseClasses] = useState(classIds.length > 0);
  const classNames = categories.filter((c) => classIds.includes(c.id)).map((c) => c.name);

  function save(e: React.FormEvent) {
    e.preventDefault();
    const view = addSavedView({
      name: name.trim() || "Untitled view",
      statuses,
      kinds,
      range,
      categoryIds: useClasses ? classIds : [],
    });
    haptic("success");
    applyView(view);
    onDone();
  }

  const chip = (on: boolean) =>
    cn(
      "h-7 rounded-full border px-2.5 text-[11.5px] font-medium transition-colors duration-[var(--motion-micro)]",
      on ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-soft hover:border-line-strong hover:text-ink"
    );

  return (
    <motion.form
      onSubmit={save}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onDone();
        }
      }}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4, transition: { duration: motionTokens.exit, ease: motionTokens.easeIn } }}
      transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
      aria-label="New view"
      className="mx-0.5 my-1.5 flex flex-col gap-2.5 rounded-lg border border-line bg-surface-sunken/50 p-2.5"
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
        placeholder="View name"
        aria-label="View name"
        className="field-control min-h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:shadow-[0_0_0_3px_var(--accent-soft)]"
      />
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-ink-faint">Status</legend>
        <div className="flex flex-wrap gap-1">
          {VIEW_STATUSES.map((o) => (
            <button key={o.value} type="button" aria-pressed={statuses.includes(o.value)} onClick={() => setStatuses(toggleIn(statuses, o.value))} className={chip(statuses.includes(o.value))}>
              {o.label}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-ink-faint">Type</legend>
        <div className="flex flex-wrap gap-1">
          {VIEW_KINDS.map((o) => (
            <button key={o.value} type="button" aria-pressed={kinds.includes(o.value)} onClick={() => setKinds(toggleIn(kinds, o.value))} className={chip(kinds.includes(o.value))}>
              {o.label}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="text-[10.5px] font-medium uppercase tracking-wider text-ink-faint">When</span>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as ViewRange)}
          className="field-control min-h-8 rounded-md border border-line bg-surface px-1.5 text-[12.5px] text-ink focus:border-accent focus:outline-none"
        >
          {VIEW_RANGES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        role="checkbox"
        aria-checked={useClasses}
        disabled={classIds.length === 0}
        onClick={() => setUseClasses((v) => !v)}
        className="flex items-start gap-2 text-left text-[12px] text-ink-soft disabled:opacity-60"
      >
        <span
          className={cn(
            "mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
            useClasses ? "border-accent bg-accent" : "border-line-strong bg-surface"
          )}
        >
          {useClasses && <Check className="h-3 w-3 text-accent-ink" strokeWidth={3} />}
        </span>
        <span className="min-w-0">
          {classIds.length === 0
            ? "Every class — pick classes below first to save a group"
            : `Only ${classNames.length <= 2 ? classNames.join(" & ") : `these ${classNames.length} classes`}`}
        </span>
      </button>
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onDone} className="h-8 rounded-md px-2.5 text-[12.5px] font-medium text-ink-soft hover:bg-surface hover:text-ink">
          Cancel
        </button>
        <button type="submit" className="h-8 rounded-md bg-accent px-3 text-[12.5px] font-medium text-accent-ink transition-opacity hover:opacity-90">
          Save
        </button>
      </div>
    </motion.form>
  );
}
