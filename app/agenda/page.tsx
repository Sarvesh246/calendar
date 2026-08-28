"use client";

import { useMemo } from "react";
import { addDays, format, startOfDay } from "date-fns";
import { useDatebookStore, useCategory } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { applyItemFilters } from "@/lib/filters";
import { dayLabel, isOverdue, itemOccupiesDay } from "@/lib/date-utils";
import { ItemCard } from "@/components/item-card";
import { EmptyState } from "@/components/empty-state";
import type { Item } from "@/lib/types";

const HORIZON_DAYS = 120;

export default function AgendaPage() {
  const allItems = useDatebookStore((s) => s.items);
  const categoryFilter = useUIStore((s) => s.categoryFilter);
  const hideCompleted = useDatebookStore((s) => s.settings.hideCompleted);
  const updateSettings = useDatebookStore((s) => s.updateSettings);
  const items = useMemo(
    () => applyItemFilters(allItems, { categoryFilter, hideCompleted }),
    [allItems, categoryFilter, hideCompleted]
  );

  const overdue = useMemo(
    () =>
      items
        .filter(isOverdue)
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
    [items]
  );

  const { groups, later } = useMemo(() => {
    const today = startOfDay(new Date());
    const cutoff = addDays(today, HORIZON_DAYS);
    const result: { date: Date; items: Item[] }[] = [];
    for (let i = 0; i < HORIZON_DAYS; i++) {
      const date = addDays(today, i);
      const dayItems = items
        .filter((it) => itemOccupiesDay(it, date) && !isOverdue(it))
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
      if (dayItems.length > 0) result.push({ date, items: dayItems });
    }
    const laterItems = items
      .filter((it) => !isOverdue(it) && new Date(it.at) >= cutoff)
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return { groups: result, later: laterItems };
  }, [items]);

  const isEmpty = overdue.length === 0 && groups.length === 0 && later.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-[var(--page-gap)]">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] italic text-ink">Agenda</h1>
          <p className="mt-1 text-[13.5px] text-ink-soft">Everything ahead, one day at a time.</p>
        </div>
        <button
          type="button"
          onClick={() => updateSettings({ hideCompleted: !hideCompleted })}
          className="shrink-0 text-[12.5px] font-medium text-ink-faint hover:text-ink"
        >
          {hideCompleted ? "Show completed" : "Hide completed"}
        </button>
      </header>

      {isEmpty && (
        <EmptyState
          title="Nothing on the horizon."
          sub="Add something with the quick-add bar above whenever you're ready."
        />
      )}

      {overdue.length > 0 && (
        <section>
          <p className="sticky top-[calc(env(safe-area-inset-top)+0.25rem)] z-10 -mx-4 mb-2.5 bg-surface-base/95 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-warn backdrop-blur-sm">
            Overdue · {overdue.length}
          </p>
          <div className="flex flex-col gap-2">
            {overdue.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}

      {groups.map((group) => {
        const label = dayLabel(group.date);
        const showDate = label === "Today" || label === "Tomorrow";
        return (
        <section key={group.date.toISOString()}>
          <p className="sticky top-[calc(env(safe-area-inset-top)+0.25rem)] z-10 -mx-4 mb-2.5 flex items-baseline gap-2 bg-surface-base/95 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-ink-faint backdrop-blur-sm">
            {label}
            {showDate && (
              <span className="normal-case tracking-normal text-ink-faint/70">
                {format(group.date, "MMM d")}
              </span>
            )}
          </p>
          <div className="flex flex-col gap-2">
            {group.items.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </div>
        </section>
        );
      })}

      {later.length > 0 && (
        <section>
          <p className="sticky top-[calc(env(safe-area-inset-top)+0.25rem)] z-10 -mx-4 mb-2.5 bg-surface-base/95 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-ink-faint backdrop-blur-sm">
            Later
          </p>
          <div className="flex flex-col gap-2">
            {later.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ItemRow({ item }: { item: Item }) {
  const category = useCategory(item.categoryId);
  return <ItemCard item={item} category={category} />;
}
