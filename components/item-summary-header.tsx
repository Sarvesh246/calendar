"use client";

import { useDatebookStore } from "@/lib/store";
import { summarizeItemWhen, type SummaryTone } from "@/lib/item-summary";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import type { Item } from "@/lib/types";

export const CHIP_TONE: Record<SummaryTone, string> = {
  warn: "bg-warn-soft text-warn",
  good: "bg-good/15 text-good",
  accent: "bg-accent-soft text-accent",
  neutral: "bg-surface-sunken text-ink-soft",
};

export const TYPE_NAME: Record<Item["type"], string> = {
  event: "Event",
  assignment: "Assignment",
  task: "Task",
};

/**
 * The answer to "what is this and is it on me?" — class, kind, full title, when,
 * and one status phrase. Read-only; the editor has its own editable version.
 */
export function ItemSummaryHeader({ item }: { item: Item }) {
  const category = useDatebookStore((s) => s.categories.find((c) => c.id === item.categoryId));
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const now = useNow();
  const summary = summarizeItemWhen(item, now, clock24h);
  const finished = item.type !== "event" && item.status === "done";

  return (
    <div className="mb-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full border border-line bg-surface-sunken px-2.5 text-[12.5px] font-semibold text-ink">
          <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: category?.color ?? "#8a8a94" }} />
          <span className="min-w-0 truncate">{category?.name ?? "No class"}</span>
        </span>
        <span className="text-[12px] font-medium text-ink-faint">
          {item.workFor ? "Planned work" : TYPE_NAME[item.type]}
        </span>
      </div>
      <h3
        className={cn(
          "text-[21px] font-semibold leading-tight tracking-tight [overflow-wrap:anywhere]",
          finished ? "text-ink-soft line-through decoration-ink-faint" : "text-ink"
        )}
      >
        {item.title}
      </h3>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <p className="text-[14px] text-ink-soft">
          {summary.date}
          {summary.date && summary.time ? " · " : ""}
          {summary.time}
        </p>
        <span className={cn("rounded-full px-2.5 py-0.5 text-[12px] font-semibold", CHIP_TONE[summary.chip.tone])}>
          {summary.chip.label}
        </span>
      </div>
    </div>
  );
}
