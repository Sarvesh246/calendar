"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { addDays, format, startOfDay } from "date-fns";
import { CalendarClock } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { applyItemFilters } from "@/lib/filters";
import { useCategoriesById, useItemCardChrome } from "@/lib/card-chrome";
import {
  dayKey,
  dayLabel,
  groupItemsByDay,
  isOverdue,
  isOverdueAt,
  itemOccupiesDay,
  openWorkDueOnDay,
  weekWorkloadFromByDay,
} from "@/lib/date-utils";
import { ItemCard } from "@/components/item-card";
import { EmptyState } from "@/components/empty-state";
import { OnboardingCard } from "@/components/onboarding-card";
import { FeedHealthBanner } from "@/components/feed-health-banner";
import { ViewMenu } from "@/components/view-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Item } from "@/lib/types";
import { useNow } from "@/lib/use-now";

const HORIZON_DAYS = 120;
const FIRST_PAINT_DAYS = 14;

const AGENDA_STICKY =
  "sticky z-10 top-[var(--mobile-header-height)] -mx-4 mb-2.5 border-b border-line/50 bg-surface-base px-4 py-2.5 md:top-0";

export default function AgendaPage() {
  const now = useNow();
  const router = useRouter();
  const setCalendarFocusDate = useUIStore((s) => s.setCalendarFocusDate);
  const allItems = useDatebookStore((s) => s.items);
  const categoryFilter = useUIStore((s) => s.categoryFilter);
  const hideCompleted = useDatebookStore((s) => s.settings.hideCompleted);
  const weekStartsOn = useDatebookStore((s) => s.settings.weekStartsOn);
  const chrome = useItemCardChrome();
  const categoriesById = useCategoriesById();
  const items = useMemo(
    () => applyItemFilters(allItems, { categoryFilter, hideCompleted }),
    [allItems, categoryFilter, hideCompleted]
  );

  const overdue = useMemo(
    () =>
      items
        .filter((item) => isOverdueAt(item, now))
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
    [items, now]
  );

  const todayCount = useMemo(() => {
    const today = startOfDay(now);
    const events = items.filter((it) => it.type === "event" && itemOccupiesDay(it, today)).length;
    return events + openWorkDueOnDay(items, today).length;
  }, [items, now]);

  const { groups, later, byDay } = useMemo(() => {
    const today = startOfDay(now);
    const cutoff = addDays(today, HORIZON_DAYS);
    const result: { date: Date; items: Item[]; key: string }[] = [];
    const byDay = groupItemsByDay(items);
    for (let i = 1; i < HORIZON_DAYS; i++) {
      const date = addDays(today, i);
      const bucket = byDay.get(dayKey(date));
      if (!bucket) continue;
      const dayItems = bucket.filter((it) => !isOverdue(it));
      if (dayItems.length > 0) result.push({ date, items: dayItems, key: dayKey(date) });
    }
    const laterItems = items
      .filter((it) => !isOverdue(it) && new Date(it.at) >= cutoff)
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return { groups: result, later: laterItems, byDay };
  }, [items, now]);

  const heat = useMemo(
    () => weekWorkloadFromByDay(byDay, now, weekStartsOn),
    [byDay, now, weekStartsOn]
  );

  const [showHorizon, setShowHorizon] = useState(false);
  useEffect(() => {
    const expand = () => startTransition(() => setShowHorizon(true));
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(expand, { timeout: 120 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(expand, 32);
    return () => window.clearTimeout(id);
  }, []);

  const visibleGroups = useMemo(() => {
    if (showHorizon) return groups;
    const limit = addDays(startOfDay(new Date()), FIRST_PAINT_DAYS);
    return groups.filter((g) => g.date < limit);
  }, [groups, showHorizon]);

  const visibleLater = showHorizon ? later : [];

  const isEmpty =
    overdue.length === 0 && groups.length === 0 && later.length === 0 && todayCount === 0;

  const sections = useMemo(() => {
    const next: { id: string; label: string; tone: "warn" | "faint" }[] = [];
    if (overdue.length > 0) {
      next.push({ id: "overdue", label: `Overdue · ${overdue.length}`, tone: "warn" });
    }
    for (const group of visibleGroups) {
      const label = dayLabel(group.date);
      const showDate = label === "Tomorrow";
      next.push({
        id: group.key,
        label: showDate ? `${label}  ${format(group.date, "MMM d")}` : label,
        tone: "faint",
      });
    }
    if (visibleLater.length > 0) {
      next.push({ id: "later", label: "Later", tone: "faint" });
    }
    return next;
  }, [overdue.length, visibleGroups, visibleLater.length]);

  const [stickyId, setStickyId] = useState<string | null>(null);

  useEffect(() => {
    if (sections.length === 0) {
      return;
    }
    const nodes = sections
      .map((s) => document.getElementById(`agenda-${s.id}`))
      .filter((el): el is HTMLElement => Boolean(el));
    if (nodes.length === 0) return;

    const update = () => {
      const header = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--mobile-header-height")
      );
      const line = (Number.isFinite(header) ? header : 56) + 8;
      let current = sections[0].id;
      for (const el of nodes) {
        if (el.getBoundingClientRect().top <= line) {
          current = el.id.replace(/^agenda-/, "");
        } else {
          break;
        }
      }
      setStickyId((previous) => previous === current ? previous : current);
    };

    let raf = requestAnimationFrame(update);
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [sections]);

  const sticky = sections.find((s) => s.id === stickyId) ?? sections[0];

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-ink">Agenda</h1>
          <p className="mt-1 text-[13px] text-ink-soft">Everything ahead, one day at a time.</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Agenda answers "what's next"; the timetable answers "what does a
              week look like". They belong within reach of each other. */}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push("/schedule")}
            aria-label="Open the full weekly schedule"
          >
            <CalendarClock className="h-3.5 w-3.5" strokeWidth={2} />
            Schedule
          </Button>
          <ViewMenu />
        </div>
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

      {sticky && (
        <p
          className={cn(
            AGENDA_STICKY,
            "pointer-events-none",
            sticky.tone === "warn" ? "text-[12px] font-medium text-warn" : "text-[12px] font-medium text-ink-faint"
          )}
        >
          {sticky.label}
        </p>
      )}

      {overdue.length > 0 && (
        <section id="agenda-overdue" className="agenda-day">
          <p className="mb-2.5 text-[12px] font-medium text-warn">Overdue · {overdue.length}</p>
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

      {visibleGroups.map((group) => {
        const label = dayLabel(group.date);
        const showDate = label === "Tomorrow";
        return (
          <section key={group.key} id={`agenda-${group.key}`} className="agenda-day">
            <p className="mb-2.5 flex items-baseline gap-2 text-[12px] font-medium text-ink-faint">
              {label}
              {showDate && (
                <span className="font-normal text-ink-faint/70">{format(group.date, "MMM d")}</span>
              )}
            </p>
            <div className="flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {group.items.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    category={item.categoryId ? categoriesById.get(item.categoryId) : undefined}
                    day={group.date}
                    {...chrome}
                  />
                ))}
              </AnimatePresence>
            </div>
          </section>
        );
      })}

      {visibleLater.length > 0 && (
        <section id="agenda-later" className="agenda-day">
          <p className="mb-2.5 text-[12px] font-medium text-ink-faint">Later</p>
          <div className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {visibleLater.map((item) => (
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
    </div>
  );
}
