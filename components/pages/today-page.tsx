"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence } from "framer-motion";
import { addDays, format, startOfDay } from "date-fns";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { applyItemFilters } from "@/lib/filters";
import { useCategoriesById, useItemCardChrome } from "@/lib/card-chrome";
import {
  dayKey,
  formatDaySummary,
  formatTime,
  happeningNowStack,
  leftoverOverdue,
  itemsOnDay,
  nextOpenAssignment,
  openWorkDueOnDay,
  relativeDueLabel,
  timeOfDayGreeting,
} from "@/lib/date-utils";
import { classCountdownWindowMs } from "@/lib/class-reminder";
import { UpNextStack } from "@/components/up-next-card";
import { ItemCard } from "@/components/item-card";
import { EmptyState } from "@/components/empty-state";
import { FocusView } from "@/components/focus-view";
import { OnboardingCard } from "@/components/onboarding-card";
import { FeedHealthBanner } from "@/components/feed-health-banner";
import { ViewMenu } from "@/components/view-menu";
import type { Category, Item } from "@/lib/types";
import { useNow } from "@/lib/use-now";

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
  const categories = useDatebookStore((s) => s.categories);
  const classReminderMinutes = useDatebookStore((s) => s.settings.classReminderMinutes);
  const chrome = useItemCardChrome();
  const categoriesById = useCategoriesById();
  const items = useMemo(
    () => applyItemFilters(allItems, { categoryFilter, hideCompleted }),
    [allItems, categoryFilter, hideCompleted]
  );

  const now = useNow();
  const todayKey = dayKey(now);
  const day = useMemo(() => startOfDay(new Date(`${todayKey}T12:00:00`)), [todayKey]);

  const dk = dayKey(day);
  const today = useMemo(() => itemsOnDay(items, day), [items, dk]); // eslint-disable-line react-hooks/exhaustive-deps
  const tomorrow = useMemo(() => itemsOnDay(items, addDays(day, 1)), [items, dk]); // eslint-disable-line react-hooks/exhaustive-deps
  const greeting = timeOfDayGreeting(now);

  const overdue = useMemo(() => leftoverOverdue(items, day), [items, dk]); // eslint-disable-line react-hooks/exhaustive-deps
  const todayList = useMemo(() => {
    const events = today.filter((i) => i.type === "event");
    const dueToday = openWorkDueOnDay(items, day);
    return [...events, ...dueToday].sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
    );
  }, [today, items, day]);
  const dueTodayCount = useMemo(() => openWorkDueOnDay(items, day).length, [items, day]);
  const eventsCount = today.filter((i) => i.type === "event").length;

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-4 sm:gap-6">
      <OnboardingCard />
      <FeedHealthBanner />
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-ink-faint">{greeting.label}</p>
          <h1 className="mt-0.5 text-[26px] font-semibold leading-tight tracking-tight text-ink sm:text-[28px]">
            {format(day, "EEEE, MMMM d")}
          </h1>
          <p className="mt-1 text-[14px] text-ink-soft">
            {formatDaySummary(eventsCount, dueTodayCount, overdue.length)}
          </p>
        </div>
        <ViewMenu showFocus />
      </header>

      <HappeningNowSection
        items={items}
        categories={categories}
        classReminderMinutes={classReminderMinutes}
        clock24h={clock24h}
      />

      {overdue.length > 0 && (
        <section>
          <SectionLabel>Overdue · {overdue.length}</SectionLabel>
          <div className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {overdue.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  category={item.categoryId ? categoriesById.get(item.categoryId) : undefined}
                  {...chrome}
                />
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
              {todayList.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  category={item.categoryId ? categoriesById.get(item.categoryId) : undefined}
                  {...chrome}
                />
              ))}
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
            <span>{format(addDays(day, 1), "EEEE, MMMM d")}</span>
            <span className="font-medium text-ink">Nothing yet · Open agenda</span>
          </Link>
        ) : (
          <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface">
            {tomorrow.slice(0, 4).map((item) => (
              <TomorrowRow
                key={item.id}
                item={item}
                clock24h={clock24h}
                category={item.categoryId ? categoriesById.get(item.categoryId) : undefined}
              />
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

function HappeningNowSection({
  items,
  categories,
  classReminderMinutes,
  clock24h,
}: {
  items: Item[];
  categories: Category[];
  classReminderMinutes: number;
  clock24h: boolean;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const { happening: liveNow, startingSoon: classSoon, upcoming: nextUpcoming } = useMemo(
    () => happeningNowStack(items, now, categories, classCountdownWindowMs(classReminderMinutes)),
    [items, now, categories, classReminderMinutes]
  );
  const nextAssignment = useMemo(() => nextOpenAssignment(items), [items]);
  const showDueNext =
    nextAssignment &&
    !liveNow.some((i) => i.id === nextAssignment.id) &&
    !classSoon.some((i) => i.id === nextAssignment.id) &&
    nextAssignment.id !== nextUpcoming?.id &&
    nextAssignment.type !== "event";

  if (liveNow.length === 0 && classSoon.length === 0 && !nextUpcoming) return null;

  return (
    <section>
      <UpNextStack
        happening={liveNow}
        startingSoon={classSoon}
        upcoming={liveNow.length === 0 && classSoon.length === 0 ? nextUpcoming : undefined}
        categoryOf={(item) => categories.find((c) => c.id === item.categoryId)}
      />
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
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[12px] font-medium text-ink-faint">{children}</p>;
}

function TomorrowRow({
  item,
  clock24h,
  category,
}: {
  item: Item;
  clock24h: boolean;
  category: Category | undefined;
}) {
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
