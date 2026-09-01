"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { addDays, format, startOfDay } from "date-fns";
import { useDatebookStore, useCategory } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { applyItemFilters } from "@/lib/filters";
import { dayKey, dayLabel, isOverdue, itemOccupiesDay, weekWorkload } from "@/lib/date-utils";
import { ItemCard } from "@/components/item-card";
import { EmptyState } from "@/components/empty-state";
import { OnboardingCard } from "@/components/onboarding-card";
import { FeedHealthBanner } from "@/components/feed-health-banner";
import { ViewMenu } from "@/components/view-menu";
import { cn } from "@/lib/utils";
import type { Item } from "@/lib/types";

const HORIZON_DAYS = 120;

const AGENDA_STICKY =
  "sticky z-10 top-[env(safe-area-inset-top,0px)] -mx-4 mb-2.5 border-b border-line/50 bg-surface-base px-4 py-2.5 md:top-0";

export default function AgendaPage() {
  const router = useRouter();
  const setCalendarFocusDate = useUIStore((s) => s.setCalendarFocusDate);
  const allItems = useDatebookStore((s) => s.items);
  const categoryFilter = useUIStore((s) => s.categoryFilter);
  const hideCompleted = useDatebookStore((s) => s.settings.hideCompleted);
  const weekStartsOn = useDatebookStore((s) => s.settings.weekStartsOn);
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

  const todayCount = useMemo(() => {
    const today = startOfDay(new Date());
    return items.filter((it) => itemOccupiesDay(it, today) && !isOverdue(it)).length;
  }, [items]);

  const { groups, later } = useMemo(() => {
    const today = startOfDay(new Date());
    const cutoff = addDays(today, HORIZON_DAYS);
    const result: { date: Date; items: Item[] }[] = [];
    for (let i = 1; i < HORIZON_DAYS; i++) {
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

  const heat = weekWorkload(items, new Date(), weekStartsOn);
  const isEmpty = overdue.length === 0 && groups.length === 0 && later.length === 0 && todayCount === 0;

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6">
      <header className="flex items-start justify-between gap-3 pt-2.5 pr-[7.25rem] md:pt-0 md:pr-0">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-ink">Agenda</h1>
          <p className="mt-1 text-[13px] text-ink-soft">Everything ahead, one day at a time.</p>
        </div>
        <ViewMenu />
      </header>

      <div className="flex gap-1">
        {heat.map((d) => (
          <button
            key={d.date.toISOString()}
            type="button"
            onClick={() => {
              setCalendarFocusDate(dayKey(d.date));
              router.push("/calendar");
            }}
            className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md py-1 transition-colors hover:bg-surface-sunken/60"
            title={`Open ${format(d.date, "EEE, MMM d")} on calendar · ${d.count} open`}
          >
            <span className={cn("text-[10px] uppercase", d.isToday ? "font-medium text-accent" : "text-ink-faint")}>
              {format(d.date, "EEEEE")}
            </span>
            <span
              className={cn(
                "h-1.5 w-full rounded-full",
                d.intensity === 0 && "bg-surface-sunken",
                d.intensity === 1 && "bg-good",
                d.intensity >= 2 && d.intensity <= 3 && "bg-accent",
                d.intensity >= 4 && "bg-warn"
              )}
            />
          </button>
        ))}
      </div>

      {isEmpty && (
        <>
          <OnboardingCard />
          <FeedHealthBanner />
          <EmptyState
            title="Nothing on the horizon."
            sub="Use Add to put something on a day whenever you're ready."
          />
        </>
      )}
      {!isEmpty && <FeedHealthBanner />}

      {overdue.length > 0 && (
        <section>
          <p className={cn(AGENDA_STICKY, "text-[12px] font-medium text-warn")}>
            Overdue · {overdue.length}
          </p>
          <div className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {overdue.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </AnimatePresence>
          </div>
        </section>
      )}

      {todayCount > 0 && (
        <Link
          href="/today"
          className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3 text-[13px] text-ink-soft hover:border-line-strong"
        >
          <span>Today</span>
          <span className="font-medium text-ink">
            {todayCount} item{todayCount === 1 ? "" : "s"} · Open Today
          </span>
        </Link>
      )}

      {groups.map((group) => {
        const label = dayLabel(group.date);
        const showDate = label === "Tomorrow";
        return (
        <section key={group.date.toISOString()}>
          <p className={cn(AGENDA_STICKY, "flex items-baseline gap-2 text-[12px] font-medium text-ink-faint")}>
            {label}
            {showDate && (
              <span className="font-normal text-ink-faint/70">
                {format(group.date, "MMM d")}
              </span>
            )}
          </p>
          <div className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {group.items.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </AnimatePresence>
          </div>
        </section>
        );
      })}

      {later.length > 0 && (
        <section>
          <p className={cn(AGENDA_STICKY, "text-[12px] font-medium text-ink-faint")}>
            Later
          </p>
          <div className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {later.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </AnimatePresence>
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
