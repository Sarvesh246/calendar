"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence } from "framer-motion";
import { addDays, format } from "date-fns";
import { useDatebookStore, useCategory } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { applyItemFilters } from "@/lib/filters";
import {
  dayKey,
  formatDaySummary,
  formatTime,
  isOverdue,
  itemsOnDay,
  nextOpenAssignment,
  relativeDueLabel,
  timeOfDayGreeting,
} from "@/lib/date-utils";
import { UpNextCard } from "@/components/up-next-card";
import { AssignmentCard, ItemCard } from "@/components/item-card";
import { EmptyState } from "@/components/empty-state";
import { FocusView } from "@/components/focus-view";
import { OnboardingCard } from "@/components/onboarding-card";
import { FeedHealthBanner } from "@/components/feed-health-banner";
import { ViewMenu } from "@/components/view-menu";
import type { Item } from "@/lib/types";

export default function TodayPage() {
  const focusMode = useUIStore((s) => s.focusMode);
  if (focusMode) return <FocusView />;
  return <TodayDashboard />;
}

function TodayDashboard() {
  const allItems = useDatebookStore((s) => s.items);
  const categoryFilter = useUIStore((s) => s.categoryFilter);
  const hideCompleted = useDatebookStore((s) => s.settings.hideCompleted);
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const items = useMemo(
    () => applyItemFilters(allItems, { categoryFilter, hideCompleted }),
    [allItems, categoryFilter, hideCompleted]
  );

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const dk = dayKey(now);
  const today = useMemo(() => itemsOnDay(items, now), [items, dk]); // eslint-disable-line react-hooks/exhaustive-deps
  const tomorrow = useMemo(() => itemsOnDay(items, addDays(now, 1)), [items, dk]); // eslint-disable-line react-hooks/exhaustive-deps
  const greeting = timeOfDayGreeting(now);

  const overdue = useMemo(
    () =>
      items
        .filter(isOverdue)
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
    [items]
  );
  const events = today.filter((i) => i.type === "event");
  const dueToday = today.filter((i) => i.type !== "event" && i.status !== "done" && !isOverdue(i));
  const todayList = today
    .filter((i) => i.type === "event" || !isOverdue(i))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const nowItem = events.find(
    (e) => e.endAt && new Date(e.at) <= now && now <= new Date(e.endAt)
  );
  const nextUpcoming = [...items]
    .filter((i) => i.status !== "done" && new Date(i.at) > now)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())[0];
  const nextItem = nowItem ?? nextUpcoming;
  const nextAssignment = useMemo(() => nextOpenAssignment(items), [items]);
  const nextItemCategory = useCategory(nextItem?.categoryId);
  const showDueNext =
    nextAssignment &&
    nextAssignment.id !== nextItem?.id &&
    (nextAssignment.type !== "event");

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-4 sm:gap-6">
      <OnboardingCard />
      <FeedHealthBanner />
      <header className="flex items-start justify-between gap-3 pt-2.5 pr-[7.25rem] md:pt-0 md:pr-0">
        <div>
          <p className="text-[13px] font-medium text-ink-faint">{greeting.label}</p>
          <h1 className="mt-0.5 text-[26px] font-semibold leading-tight tracking-tight text-ink sm:text-[28px]">
            {format(now, "EEEE, MMMM d")}
          </h1>
          <p className="mt-1 text-[14px] text-ink-soft">
            {formatDaySummary(events.length, dueToday.length, overdue.length)}
          </p>
        </div>
        <ViewMenu showFocus />
      </header>

      {nextItem && (
        <section>
          <UpNextCard item={nextItem} category={nextItemCategory} />
          {showDueNext && nextAssignment && (
            <p className="mt-2 px-0.5 text-[13px] text-ink-soft">
              <span className="font-medium text-ink">Due next</span>
              {" · "}
              {nextAssignment.title}
              {" · "}
              {nextAssignment.allDay
                ? relativeDueLabel(nextAssignment.at, { allDay: true })
                : formatTime(nextAssignment.at, clock24h)}
            </p>
          )}
        </section>
      )}

      {overdue.length > 0 && (
        <section>
          <SectionLabel>Overdue · {overdue.length}</SectionLabel>
          {/* AnimatePresence lets a completed or deleted row collapse out of the
              list instead of the rows below snapping up a frame later. */}
          <div className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {overdue.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </AnimatePresence>
          </div>
        </section>
      )}

      <section>
        <SectionLabel>Today</SectionLabel>
        {todayList.length === 0 ? (
          <EmptyState
            title={overdue.length > 0 ? "Nothing else today." : "Clear day."}
            sub="Classes and due work will show up here in time order."
          />
        ) : (
          <div className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {todayList.map((item) =>
                item.type === "event" ? (
                  <ItemRow key={item.id} item={item} />
                ) : (
                  <AssignmentCardRow key={item.id} itemId={item.id} />
                )
              )}
            </AnimatePresence>
          </div>
        )}
      </section>

      <section>
        <SectionLabel>Tomorrow</SectionLabel>
        {tomorrow.length === 0 ? (
          <Link
            href="/agenda"
            className="press-none flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-[13px] text-ink-soft transition-colors hover:border-line-strong hover:bg-surface-sunken/50"
          >
            <span>{format(addDays(now, 1), "EEEE, MMMM d")}</span>
            <span className="font-medium text-ink">Nothing yet · Open agenda</span>
          </Link>
        ) : (
          <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface">
            {tomorrow.slice(0, 4).map((item) => (
              <TomorrowRow key={item.id} item={item} clock24h={clock24h} />
            ))}
            <Link
              href="/agenda"
              className="border-t border-line px-4 py-2.5 text-[12px] font-medium text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              {tomorrow.length > 4
                ? `And ${tomorrow.length - 4} more on the agenda`
                : "Open agenda"}
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[12px] font-medium text-ink-faint">{children}</p>;
}

function ItemRow({ item }: { item: Item }) {
  const category = useCategory(item.categoryId);
  return <ItemCard item={item} category={category} />;
}

function AssignmentCardRow({ itemId }: { itemId: string }) {
  const item = useDatebookStore((s) => s.items.find((i) => i.id === itemId));
  const category = useCategory(item?.categoryId);
  if (!item) return null;
  return <AssignmentCard item={item} category={category} />;
}

function TomorrowRow({ item, clock24h }: { item: Item; clock24h: boolean }) {
  const category = useCategory(item.categoryId);
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: category?.color ?? "#8a8a94" }}
      />
      <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{item.title}</p>
      <span className="shrink-0 text-[12px] tabular-nums text-ink-faint">
        {item.allDay ? "All day" : formatTime(item.at, clock24h)}
      </span>
    </div>
  );
}
