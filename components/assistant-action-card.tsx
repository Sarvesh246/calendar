"use client";

import { ArrowRight, Check, Trash2 } from "lucide-react";
import { SelectMenu } from "@/components/ui/select-menu";
import { motion } from "framer-motion";
import { OUTCOME_COPY, type ActionOutcome } from "@/lib/assistant-staleness";
import { describeAction, type DescribableItem } from "@/lib/assistant-actions";
import type { AssistantAction } from "@/lib/ai-assistant";
import { categoryLabel } from "@/lib/course-name";
import { motion as motionTokens } from "@/lib/motion";
import type { Category } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * One staged change, written from the action itself rather than from whatever
 * string an engine produced — so a model's reschedule reads exactly like the
 * on-device engine's, with the old and new values side by side, and a series
 * says how many items it will write before anyone taps Add.
 */
export function AssistantActionCard({
  action,
  outcome,
  items,
  categories,
  clock24h,
  docked,
  onApply,
  onDismiss,
  onUndo,
  onClassChange,
}: {
  action: AssistantAction;
  outcome?: ActionOutcome;
  items: DescribableItem[];
  categories: Category[];
  clock24h: boolean;
  docked?: boolean;
  onApply: () => void;
  onDismiss: () => void;
  /** Offered beside "Done"; puts back what this card changed. */
  onUndo?: () => void;
  onClassChange?: (categoryId: string) => void;
}) {
  const d = describeAction(action, items, clock24h, categories);
  const live = categories.filter((c) => !c.archived || c.id === d.categoryId);
  const current = categories.find((c) => c.id === d.categoryId);

  return (
    <div
      className={cn("rounded-xl border border-line bg-surface-sunken p-3", !docked && "md:p-3.5")}
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">{d.verb}</p>
      <p className="mt-0.5 break-words text-[14px] font-semibold leading-snug text-ink">
        {d.title}
      </p>
      {d.when && <p className="mt-0.5 text-[13px] text-ink-soft">{d.when}</p>}
      {d.series && <p className="mt-0.5 text-[13px] font-medium text-warn">{d.series}</p>}

      {d.changes.length > 0 && (
        <dl className="mt-1.5 space-y-1">
          {d.changes.map((c) => (
            <div key={c.field} className="flex flex-wrap items-baseline gap-x-1.5 text-[13px]">
              <dt className="w-full text-[11px] font-medium text-ink-faint">{c.field}</dt>
              {c.from !== undefined && (
                <>
                  <dd className="text-ink-faint line-through decoration-ink-faint/60">{c.from}</dd>
                  <ArrowRight
                    aria-label="to"
                    className="h-3 w-3 shrink-0 translate-y-[2px] text-ink-faint"
                    strokeWidth={2}
                  />
                </>
              )}
              <dd className="font-medium text-ink">{c.to}</dd>
            </div>
          ))}
        </dl>
      )}

      {d.facts.length > 0 && (
        <p className="mt-0.5 text-[12px] text-ink-faint">{d.facts.join(" · ")}</p>
      )}

      {action.kind === "create" && live.length > 0 && !outcome && (
        <SelectMenu
          label="Class"
          value={d.categoryId ?? ""}
          onChange={(id) => onClassChange?.(id)}
          className="mt-2 inline-block max-w-full"
          buttonClassName="min-h-10 rounded-full border border-line bg-surface px-3 text-[12.5px] text-ink-soft transition-colors hover:border-ink-faint focus-visible:border-accent"
          leading={
            current ? (
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: current.color }}
              />
            ) : null
          }
          options={[
            ...(current ? [] : [{ value: "", label: "No class" }]),
            ...live.map((c) => ({
              value: c.id,
              label: categoryLabel(categories, c),
              color: c.color,
            })),
          ]}
        />
      )}

      {outcome === "applied" ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <motion.p
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={motionTokens.springSnappy}
            className="flex items-center gap-1 text-[13px] font-medium text-good"
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> Done
          </motion.p>
          {onUndo && (
            <button
              type="button"
              onClick={onUndo}
              className="min-h-11 rounded-lg px-3 text-[13px] font-medium text-ink-soft hover:bg-surface hover:text-accent"
            >
              Undo
            </button>
          )}
        </div>
      ) : outcome === "dismissed" ? (
        <p className="mt-2 text-[13px] text-ink-faint">Dismissed</p>
      ) : outcome ? (
        <p className="mt-2 text-[13px] text-ink-faint">{OUTCOME_COPY[outcome]}</p>
      ) : (
        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="min-h-11 min-w-20 rounded-lg px-3.5 text-[13px] font-medium text-ink-soft hover:bg-surface"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onApply}
            className={cn(
              "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-4 text-[13.5px] font-semibold text-accent-ink hover:opacity-90 md:flex-none",
              action.kind === "delete" ? "bg-warn" : "bg-accent",
            )}
          >
            {action.kind === "delete" && <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />}
            {d.verb}
          </button>
        </div>
      )}
    </div>
  );
}
