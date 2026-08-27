"use client";

import { useMemo } from "react";
import { addDays, format, isSameDay, startOfDay } from "date-fns";
import { useDatebookStore, useCategory } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { applyCategoryFilter } from "@/lib/filters";
import { dayLabel, isOverdue } from "@/lib/date-utils";
import { ItemCard } from "@/components/item-card";
import { EmptyState } from "@/components/empty-state";
import type { Item } from "@/lib/types";

const HORIZON_DAYS = 45;

export default function AgendaPage() {
  const allItems = useDatebookStore((s) => s.items);
  const categoryFilter = useUIStore((s) => s.categoryFilter);
  const items = useMemo(() => applyCategoryFilter(allItems, categoryFilter), [allItems, categoryFilter]);

  const overdue = useMemo(
    () =>
      items
        .filter(isOverdue)
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
    [items]
  );

  const groups = useMemo(() => {
    const today = startOfDay(new Date());
    const result: { date: Date; items: Item[] }[] = [];
    for (let i = 0; i < HORIZON_DAYS; i++) {
      const date = addDays(today, i);
      const dayItems = items
        .filter((it) => isSameDay(new Date(it.at), date) && !isOverdue(it))
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
      if (dayItems.length > 0) result.push({ date, items: dayItems });
    }
    return result;
  }, [items]);

  const isEmpty = overdue.length === 0 && groups.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8">
      <header>
        <h1 className="font-display text-[28px] italic text-ink">Agenda</h1>
        <p className="mt-1 text-[13.5px] text-ink-soft">Everything ahead, one day at a time.</p>
      </header>

      {isEmpty && (
        <EmptyState
          title="Nothing on the horizon."
          sub="Add something with the quick-add bar above whenever you're ready."
        />
      )}

      {overdue.length > 0 && (
        <section>
          <p className="mb-2.5 text-[11px] font-medium uppercase tracking-wider text-warn">
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
          <p className="mb-2.5 flex items-baseline gap-2 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
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
    </div>
  );
}

function ItemRow({ item }: { item: Item }) {
  const category = useCategory(item.categoryId);
  return <ItemCard item={item} category={category} />;
}
