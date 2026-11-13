"use client";

import { useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { animate, motion, useMotionValue } from "framer-motion";
import { cn } from "@/lib/utils";
import { motion as motionTokens } from "@/lib/motion";
import { formatOffsetLabel } from "@/lib/reminder-defaults";
import type { ReminderPreset } from "@/lib/types";

export const REMINDER_REVEAL = 76;

/**
 * A settings row that taps to toggle default, with always-visible Edit /
 * Delete. On touch, swipe still reveals the same actions as a shortcut.
 */
export function ReminderPresetRow({
  preset,
  active,
  onToggle,
  onEdit,
  onDelete,
}: {
  preset: ReminderPreset;
  active: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const x = useMotionValue(0);
  const [open, setOpen] = useState<"none" | "edit" | "delete">("none");

  function snapTo(target: number, next: "none" | "edit" | "delete") {
    animate(x, target, { type: "spring", stiffness: 460, damping: 40 });
    setOpen(next);
  }

  return (
    <div className="relative overflow-hidden rounded-xl">
      <div
        className="absolute inset-0 flex items-stretch justify-between md:hidden"
        aria-hidden={open === "none"}
      >
        <button
          type="button"
          tabIndex={open === "edit" ? 0 : -1}
          onClick={() => {
            snapTo(0, "none");
            onEdit();
          }}
          className="flex w-[76px] items-center justify-center gap-1 bg-accent text-[12.5px] font-medium text-accent-ink"
          aria-label={`Rename ${preset.label}`}
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={2} /> Edit
        </button>
        <button
          type="button"
          tabIndex={open === "delete" ? 0 : -1}
          onClick={() => {
            setOpen("none");
            onDelete();
          }}
          className="flex w-[76px] items-center justify-center gap-1 bg-warn text-[12.5px] font-medium text-white"
          aria-label={`Delete ${preset.label}`}
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} /> Delete
        </button>
      </div>

      <motion.div
        drag="x"
        style={{ x }}
        dragConstraints={{ left: -REMINDER_REVEAL, right: REMINDER_REVEAL }}
        dragElastic={0.04}
        onDragEnd={(_, info) => {
          if (info.offset.x <= -REMINDER_REVEAL / 2) snapTo(-REMINDER_REVEAL, "delete");
          else if (info.offset.x >= REMINDER_REVEAL / 2) snapTo(REMINDER_REVEAL, "edit");
          else snapTo(0, "none");
        }}
        className={cn(
          "relative z-[1] flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-left text-[14px] transition-colors",
          active
            ? "border-accent/40 bg-accent-soft text-ink"
            : "border-line/80 bg-surface text-ink-soft hover:border-line-strong",
        )}
      >
        <button
          type="button"
          onClick={() => {
            if (open !== "none") {
              snapTo(0, "none");
              return;
            }
            onToggle();
          }}
          className="flex min-h-9 min-w-0 flex-1 items-center justify-between gap-2 text-left"
        >
          <span className="truncate">{preset.label}</span>
          {active && <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={2.5} />}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="flex min-h-9 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-ink-soft hover:bg-surface-sunken hover:text-ink"
            aria-label={`Edit ${preset.label}`}
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="flex min-h-9 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-warn hover:bg-warn-soft"
            aria-label={`Delete ${preset.label}`}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
            Delete
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export function EditReminderRow({
  preset,
  onSave,
  onCancel,
}: {
  preset: ReminderPreset;
  onSave: (patch: { label: string; offsetMinutes: number }) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(preset.label);
  const [minutes, setMinutes] = useState(String(preset.offsetMinutes));

  function save() {
    const n = parseInt(minutes, 10);
    if (!Number.isFinite(n) || n < 1) return;
    onSave({ label: label.trim() || formatOffsetLabel(n), offsetMinutes: n });
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={motionTokens.springSnappy}
      className="field-shell flex items-center gap-2 rounded-xl border border-accent/40 bg-accent-soft px-3 py-2"
    >
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Label"
        aria-label="Reminder label"
        className="min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-faint focus:outline-none"
      />
      <input
        type="number"
        min={1}
        value={minutes}
        onChange={(e) => setMinutes(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") onCancel();
        }}
        aria-label="Minutes before"
        className="w-14 shrink-0 bg-transparent text-[14px] text-ink focus:outline-none"
      />
      <span className="shrink-0 text-[11px] text-ink-faint">min</span>
      <button
        type="button"
        onClick={save}
        aria-label="Save reminder"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink"
      >
        <Check className="h-4 w-4" strokeWidth={2.5} />
      </button>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-faint hover:bg-surface hover:text-ink"
      >
        <X className="h-4 w-4" strokeWidth={2} />
      </button>
    </motion.div>
  );
}
