"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { addDays, format } from "date-fns";
import { Minimize2 } from "lucide-react";
import { useDatebookStore, useCategory } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { applyItemFilters } from "@/lib/filters";
import { dayKey, isOverdue, itemsOnDay, timeOfDayGreeting, weekWorkload, workloadIntensity } from "@/lib/date-utils";
import { UpNextCard } from "@/components/up-next-card";
import { AssignmentCard, ItemCard } from "@/components/item-card";
import { EmptyState } from "@/components/empty-state";
import { FocusView } from "@/components/focus-view";
import { OnboardingCard } from "@/components/onboarding-card";
import { FeedHealthBanner } from "@/components/feed-health-banner";
import { cn } from "@/lib/utils";
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
  const weekStartsOn = useDatebookStore((s) => s.settings.weekStartsOn);
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
  const dueToday = today.filter((i) => i.type !== "event" && i.status !== "done" && !isOverdue(i));
  const events = today.filter((i) => i.type === "event");

  const nowItem = events.find(
    (e) => e.endAt && new Date(e.at) <= now && now <= new Date(e.endAt)
  );
  const nextItem = useMemo(
    () =>
      nowItem ??
      [...items]
        .filter((i) => i.status !== "done" && new Date(i.at) > now)
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())[0],
    [items, now, nowItem]
  );

  const intensity = workloadIntensity(overdue.length + dueToday.length + events.length);
  const barCount = Math.min(10, overdue.length + dueToday.length + events.length);
  const segments = Array.from({ length: 10 }, (_, i) => i < barCount);
  const nextItemCategory = useCategory(nextItem?.categoryId);
  const toggleFocusMode = useUIStore((s) => s.toggleFocusMode);
  const updateSettings = useDatebookStore((s) => s.updateSettings);

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-4 sm:gap-[var(--page-gap)]">
      <OnboardingCard />
      <FeedHealthBanner />
      <header className="flex items-start justify-between gap-3 sm:gap-4">
        <div>
          <p className="text-[13px] font-medium text-ink-faint">{greeting.label}</p>
          <h1 className="font-display mt-0.5 text-[34px] italic leading-none text-ink sm:text-[40px]">
            {format(now, "EEEE")}
          </h1>
          <p className="mt-1 text-[14px] text-ink-soft sm:text-[15px]">
            {format(now, "MMMM d")} · {greeting.sub}
          </p>

          <div className="mt-3 flex items-center gap-2 sm:mt-4 sm:gap-2.5">
            <div className="flex gap-[3px]">
              {segments.map((filled, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1.5 w-3 rounded-full transition-colors",
                    filled ? intensityClass(intensity) : "bg-surface-sunken"
                  )}
                />
              ))}
            </div>
            <span className="text-[12.5px] text-ink-faint">
              {overdue.length + dueToday.length + events.length} thing
              {overdue.length + dueToday.length + events.length === 1 ? "" : "s"} on your plate
            </span>
          </div>
          <WeekHeat items={items} weekStartsOn={weekStartsOn} />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <button
            onClick={toggleFocusMode}
            className="flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
          >
            <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.9} />
            Focus
          </button>
          <button
            type="button"
            onClick={() => updateSettings({ hideCompleted: !hideCompleted })}
            className="text-[12px] font-medium text-ink-faint hover:text-ink"
          >
            {hideCompleted ? "Show completed" : "Hide completed"}
          </button>
        </div>
      </header>

      {nextItem && (
        <section>
          <UpNextCard item={nextItem} category={nextItemCategory} />
        </section>
      )}

      {overdue.length > 0 && (
        <section>
          <SectionLabel>Overdue · {overdue.length}</SectionLabel>
          <div className="flex flex-col gap-2">
            {overdue.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionLabel>Today&apos;s schedule</SectionLabel>
        {events.length === 0 ? (
          <EmptyState title="No events today." sub="Classes and meetings will show up here." />
        ) : (
          <div className="flex flex-col gap-2">
            {events.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionLabel>Due today</SectionLabel>
        {dueToday.length === 0 ? (
          <EmptyState title="Clear day." sub="Nothing due today — you've got some breathing room." />
        ) : (
          <div className="flex flex-col gap-2">
            {dueToday.map((item) => (
              <AssignmentCardRow key={item.id} itemId={item.id} />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionLabel>Tomorrow</SectionLabel>
        <Link
          href="/calendar"
          className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3 text-[13.5px] text-ink-soft transition-colors hover:border-line-strong"
        >
          <span>{format(addDays(now, 1), "EEEE, MMMM d")}</span>
          <span className="font-medium text-ink">
            {tomorrow.length === 0 ? "Nothing yet" : `${tomorrow.length} thing${tomorrow.length === 1 ? "" : "s"}`}
          </span>
        </Link>
      </section>
    </div>
  );
}

function intensityClass(intensity: number) {
  return ["bg-surface-sunken", "bg-good", "bg-accent", "bg-warn", "bg-warn"][intensity] ?? "bg-accent";
}

function WeekHeat({
  items,
  weekStartsOn,
}: {
  items: Item[];
  weekStartsOn: 0 | 1;
}) {
  const days = weekWorkload(items, new Date(), weekStartsOn);
  return (
    <div className="mt-3 flex gap-1">
      {days.map((d) => (
        <div key={d.date.toISOString()} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <span className={cn("text-[10px] uppercase", d.isToday ? "font-medium text-accent" : "text-ink-faint")}>
            {format(d.date, "EEEEE")}
          </span>
          <span
            className={cn("h-1.5 w-full rounded-full", intensityClass(d.intensity))}
            title={`${format(d.date, "EEE")} · ${d.count} open`}
          />
        </div>
      ))}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint sm:mb-2.5">
      {children}
    </p>
  );
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
