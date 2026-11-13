"use client";

import { useState } from "react";
import { Check, Flag, ListChecks, Plus, Timer, X } from "lucide-react";
import { formatDuration } from "@/lib/work-sessions";
import { nanoid } from "@/lib/nanoid";
import { haptic } from "@/lib/haptic";
import { cn } from "@/lib/utils";
import type { Item, ItemPriority, Subtask } from "@/lib/types";

const PRIORITIES: { value: ItemPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
];

// Common effort sizes for coursework; "Other" values already on an item are kept.
const ESTIMATES = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480];

const FIELD =
  "field-control min-h-9 rounded-md border border-line bg-surface px-2 py-1.5 text-[13px] text-ink " +
  "transition-[border-color,box-shadow,background-color] duration-[var(--motion-standard)] ease-[var(--ease-standard)] " +
  "hover:border-line-strong focus:border-accent focus:bg-surface-elevated focus:outline-none " +
  "focus:shadow-[0_0_0_3px_var(--accent-soft)]";

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 shrink-0 text-ink-faint">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10.5px] font-medium uppercase tracking-wider text-ink-faint">{label}</p>
        <div className="mt-0.5 text-[12.5px] text-ink-soft">{children}</div>
      </div>
    </div>
  );
}

/**
 * Priority, effort estimate and a checklist for an assignment or task. The
 * estimate sets the length of the next "Plan a work session"; the checklist is
 * plain steps, ticked off inline.
 */
export function ItemPlanning({
  item,
  patch,
}: {
  item: Item;
  patch: (next: Partial<Item>) => void;
}) {
  const [draft, setDraft] = useState("");
  const subtasks = item.subtasks ?? [];
  const done = subtasks.filter((t) => t.done).length;
  const priority: ItemPriority = item.priority ?? "normal";
  const estimate = item.estimateMinutes;
  const estimateOptions =
    estimate && !ESTIMATES.includes(estimate)
      ? [...ESTIMATES, estimate].sort((a, b) => a - b)
      : ESTIMATES;

  const setSubtasks = (next: Subtask[]) => patch({ subtasks: next.length ? next : undefined });

  const addSubtask = () => {
    const title = draft.trim();
    if (!title) return;
    setSubtasks([...subtasks, { id: nanoid(), title, done: false }]);
    setDraft("");
    haptic("light");
  };

  return (
    <div className="flex flex-col gap-4">
      <Row icon={<Flag className="h-3.5 w-3.5" strokeWidth={1.75} />} label="Priority">
        <div role="radiogroup" aria-label="Priority" className="mt-0.5 inline-flex gap-1">
          {PRIORITIES.map((p) => (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={priority === p.value}
              onClick={() => {
                haptic("light");
                patch({ priority: p.value === "normal" ? undefined : p.value });
              }}
              className={cn(
                "min-h-9 rounded-md border px-3 text-[12.5px] font-medium transition-colors duration-[var(--motion-micro)]",
                priority === p.value
                  ? p.value === "high"
                    ? "border-warn/50 bg-warn/10 text-warn"
                    : "border-accent/50 bg-accent-soft text-ink"
                  : "border-line text-ink-soft hover:text-ink",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Row>

      <Row icon={<Timer className="h-3.5 w-3.5" strokeWidth={1.75} />} label="Effort">
        <select
          aria-label="Estimated effort"
          value={estimate ?? ""}
          onChange={(e) =>
            patch({ estimateMinutes: e.target.value ? Number(e.target.value) : undefined })
          }
          className={cn(FIELD, "mt-0.5 w-full")}
        >
          <option value="">No estimate</option>
          {estimateOptions.map((m) => (
            <option key={m} value={m}>
              About {formatDuration(m)}
            </option>
          ))}
        </select>
      </Row>

      <Row
        icon={<ListChecks className="h-3.5 w-3.5" strokeWidth={1.75} />}
        label={subtasks.length ? `Checklist · ${done}/${subtasks.length}` : "Checklist"}
      >
        <ul className="mt-0.5 flex flex-col gap-1">
          {subtasks.map((t) => (
            <li key={t.id} className="group flex items-center gap-2">
              <button
                type="button"
                role="checkbox"
                aria-checked={t.done}
                aria-label={t.title}
                onClick={() => {
                  haptic("light");
                  setSubtasks(subtasks.map((s) => (s.id === t.id ? { ...s, done: !s.done } : s)));
                }}
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors duration-[var(--motion-micro)]",
                  t.done ? "border-accent bg-accent text-accent-ink" : "border-line-strong",
                )}
              >
                {t.done && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />}
              </button>
              <span
                className={cn(
                  "min-w-0 flex-1 break-words text-[13px] text-ink",
                  t.done && "text-ink-faint line-through",
                )}
              >
                {t.title}
              </span>
              <button
                type="button"
                aria-label={`Remove ${t.title}`}
                onClick={() => setSubtasks(subtasks.filter((s) => s.id !== t.id))}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-surface-sunken hover:text-ink"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-1.5 flex gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addSubtask();
              }
            }}
            placeholder="Add a step"
            aria-label="Add a step"
            className={cn(FIELD, "min-w-0 flex-1")}
          />
          <button
            type="button"
            onClick={addSubtask}
            disabled={!draft.trim()}
            aria-label="Add step"
            className="flex min-h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-ink-soft hover:text-ink disabled:opacity-40"
          >
            <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
          </button>
        </div>
      </Row>
    </div>
  );
}
