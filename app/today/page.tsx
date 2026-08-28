"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { addDays, format } from "date-fns";
import { Minimize2 } from "lucide-react";
import { useDatebookStore, useCategory } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { applyCategoryFilter } from "@/lib/filters";
import { dayKey, itemsOnDay, timeOfDayGreeting, workloadIntensity } from "@/lib/date-utils";
import { UpNextCard } from "@/components/up-next-card";
import { AssignmentCard } from "@/components/item-card";
import { EmptyState } from "@/components/empty-state";
import { FocusView } from "@/components/focus-view";
import { cn } from "@/lib/utils";

export default function TodayPage() {
  const focusMode = useUIStore((s) => s.focusMode);
  if (focusMode) return <FocusView />;
  return <TodayDashboard />;
}

function TodayDashboard() {
  const allItems = useDatebookStore((s) => s.items);
  const categoryFilter = useUIStore((s) => s.categoryFilter);
  const items = useMemo(() => applyCategoryFilter(allItems, categoryFilter), [allItems, categoryFilter]);

  // Re-tick every minute so "Due today", "Up next", the greeting, and the
  // day rollover stay live on a page that's routinely left open for hours.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const dk = dayKey(now);
  const today = useMemo(() => itemsOnDay(items, now), [items, dk]); // eslint-disable-line react-hooks/exhaustive-deps
  const tomorrow = useMemo(() => itemsOnDay(items, addDays(now, 1)), [items, dk]); // eslint-disable-line react-hooks/exhaustive-deps
  const greeting = timeOfDayGreeting(now);

  const dueToday = today.filter((i) => i.type !== "event" && i.status !== "done");
  const events = today.filter((i) => i.type === "event");

  const nowItem = events.find(
    (e) => e.endAt && new Date(e.at) <= now && now <= new Date(e.endAt) && e.status !== "done"
  );
  const nextItem = useMemo(
    () =>
      nowItem ??
      [...items]
        .filter((i) => i.status !== "done" && new Date(i.at) > now)
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())[0],
    [items, now, nowItem]
  );

  const intensity = workloadIntensity(today.length);
  const segments = Array.from({ length: 10 }, (_, i) => i < today.length);
  const nextItemCategory = useCategory(nextItem?.categoryId);
  const toggleFocusMode = useUIStore((s) => s.toggleFocusMode);

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-ink-faint">{greeting.label}</p>
          <h1 className="font-display mt-0.5 text-[40px] italic leading-none text-ink">
            {format(now, "EEEE")}
          </h1>
          <p className="mt-1 text-[15px] text-ink-soft">{format(now, "MMMM d")} · {greeting.sub}</p>

          <div className="mt-4 flex items-center gap-2.5">
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
              {today.length} thing{today.length === 1 ? "" : "s"} today
            </span>
          </div>
        </div>
        <button
          onClick={toggleFocusMode}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
        >
          <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.9} />
          Focus
        </button>
      </header>

      {nextItem && (
        <section>
          <UpNextCard item={nextItem} category={nextItemCategory} />
        </section>
      )}

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

function SectionLabel({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
      {icon}
      {children}
    </p>
  );
}

function AssignmentCardRow({ itemId }: { itemId: string }) {
  const item = useDatebookStore((s) => s.items.find((i) => i.id === itemId));
  const category = useCategory(item?.categoryId);
  if (!item) return null;
  return <AssignmentCard item={item} category={category} />;
}
