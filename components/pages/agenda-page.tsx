"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { addDays, format, startOfDay } from "date-fns";
import { LayoutList, Rows3 } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useFilterBreakdown, useFilteredItems } from "@/lib/use-filtered-items";
import { useWorkspacePrefs, type AgendaLayout } from "@/lib/workspace-prefs";
import { useMediaQuery } from "@/lib/use-media-query";
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
import { AgendaRows, type AgendaRowSection } from "@/components/agenda-rows";
import { AgendaSticky } from "@/components/agenda-sticky";
import type { AgendaStickySection } from "@/lib/agenda-sticky";
import { ListEmptyState } from "@/components/list-empty-state";
import { OnboardingCard } from "@/components/onboarding-card";
import { FeedHealthBanner } from "@/components/feed-health-banner";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Item } from "@/lib/types";
import { useNow } from "@/lib/use-now";

const HORIZON_DAYS = 120;
const FIRST_PAINT_OVERDUE = 12;
const OVERDUE_PAGE_SIZE = 24;
const FIRST_PAINT_GROUPS = 8;
const GROUP_PAGE_SIZE = 8;
const FIRST_PAINT_LATER = 24;
const LATER_PAGE_SIZE = 24;
const NO_ITEMS: Item[] = [];

const LAYOUTS: { value: AgendaLayout; label: string; Icon: typeof LayoutList }[] = [
  { value: "cards", label: "Cards", Icon: LayoutList },
  { value: "rows", label: "Rows", Icon: Rows3 },
];

export default function AgendaPage() {
  const now = useNow();
  const router = useRouter();
  const setCalendarFocusDate = useUIStore((s) => s.setCalendarFocusDate);
  const allItems = useDatebookStore((s) => s.items);
  const items = useFilteredItems();
  const weekStartsOn = useDatebookStore((s) => s.settings.weekStartsOn);
  const chrome = useItemCardChrome();
  const categoriesById = useCategoriesById();
  const desktop = useMediaQuery("(min-width: 768px)");
  const layout = useWorkspacePrefs((s) => s.agendaLayout);
  const setLayout = useWorkspacePrefs((s) => s.setAgendaLayout);
  // Rows are a desk layout; a phone always gets cards.
  const rows = desktop && layout === "rows";

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

  const [overdueLimit, setOverdueLimit] = useState(FIRST_PAINT_OVERDUE);
  const [groupLimit, setGroupLimit] = useState(FIRST_PAINT_GROUPS);
  const [laterLimit, setLaterLimit] = useState(FIRST_PAINT_LATER);

  // Busy semesters can contain hundreds of cards. Agenda renders the first
  // useful screen immediately, then a sentinel fills the next page just before
  // it scrolls into view. This preserves the complete list and its natural
  // scroll position without one giant post-navigation render.
  const visibleOverdue = overdue.slice(0, overdueLimit);
  const visibleGroups = groups.slice(0, groupLimit);
  const allGroupsVisible = visibleGroups.length >= groups.length;
  const visibleLater = allGroupsVisible ? later.slice(0, laterLimit) : NO_ITEMS;
  const revealMoreGroups = useCallback(() => {
    startTransition(() => setGroupLimit((limit) => limit + GROUP_PAGE_SIZE));
  }, []);
  const revealMoreLater = useCallback(() => {
    startTransition(() => setLaterLimit((limit) => limit + LATER_PAGE_SIZE));
  }, []);
  const revealMoreOverdue = useCallback(() => {
    startTransition(() => setOverdueLimit((limit) => limit + OVERDUE_PAGE_SIZE));
  }, []);

  const isEmpty =
    overdue.length === 0 && groups.length === 0 && later.length === 0 && todayCount === 0;

  // Agenda's scope is everything from today on, so a horizon full of completed
  // work reads as "Everything completed" rather than an empty calendar.
  const ahead = useMemo(() => {
    const today = startOfDay(now).getTime();
    return allItems.filter((it) => {
      const at = new Date(it.at).getTime();
      return !Number.isNaN(at) && at >= today;
    });
  }, [allItems, now]);
  const breakdown = useFilterBreakdown(ahead);

  const sections = useMemo(() => {
    const next: AgendaStickySection[] = [];
    if (overdue.length > 0) {
      next.push({ id: "overdue", kind: "overdue", tone: "warn", count: overdue.length });
    }
    for (const group of visibleGroups) {
      next.push({
        id: group.key,
        kind: "day",
        tone: "faint",
        count: group.items.length,
        date: group.date,
      });
    }
    if (visibleLater.length > 0) {
      next.push({ id: "later", kind: "later", tone: "faint", count: visibleLater.length });
    }
    return next;
  }, [overdue.length, visibleGroups, visibleLater]);

  const rowSections = useMemo<AgendaRowSection[]>(() => {
    if (!rows) return [];
    const out: AgendaRowSection[] = [];
    if (visibleOverdue.length) out.push({ id: "overdue", label: `Overdue · ${overdue.length}`, tone: "warn", items: visibleOverdue });
    for (const g of visibleGroups) {
      const label = dayLabel(g.date);
      out.push({
        id: g.key,
        label: label === format(g.date, "EEEE, MMMM d") ? label : `${label} · ${format(g.date, "MMM d")}`,
        tone: "faint",
        items: g.items,
        dayKey: g.key,
      });
    }
    if (visibleLater.length) out.push({ id: "later", label: "Later", tone: "faint", items: visibleLater });
    return out;
  }, [rows, overdue.length, visibleOverdue, visibleGroups, visibleLater]);

  const todayLink = todayCount > 0 && (
    <Link
      href="/today"
      className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3 text-[13px] text-ink-soft hover:border-line-strong"
    >
      <span>Today</span>
      <span className="font-medium text-ink">
        {todayCount} item{todayCount === 1 ? "" : "s"} · Open Today
      </span>
    </Link>
  );

  return (
    <div className={cn("mx-auto flex w-full flex-col gap-6", rows ? "max-w-[1080px]" : "max-w-[880px]")}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-ink">Agenda</h1>
          <p className="mt-1 text-[13px] text-ink-soft">Everything ahead, one day at a time.</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <div role="radiogroup" aria-label="Agenda layout" className="hidden items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 md:flex">
            {LAYOUTS.map(({ value, label, Icon }) => {
              const active = layout === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    if (active) return;
                    haptic("light");
                    startTransition(() => setLayout(value));
                  }}
                  className={cn(
                    "press-none relative flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium",
                    "transition-colors duration-[var(--motion-standard)]",
                    active ? "text-accent-ink" : "text-ink-soft hover:text-ink"
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="agenda-layout-pill"
                      className="absolute inset-0 rounded-md bg-accent"
                      transition={motionTokens.spring}
                    />
                  )}
                  <Icon className="relative z-[1] h-3.5 w-3.5" strokeWidth={1.9} />
                  <span className="relative z-[1]">{label}</span>
                </button>
              );
            })}
          </div>
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
          <ListEmptyState
            scope="the agenda"
            total={breakdown.total}
            hiddenByCategory={breakdown.hiddenByCategory}
            hiddenByCompletion={breakdown.hiddenByCompletion}
            hiddenByView={breakdown.hiddenByView}
          />
        </>
      )}
      {!isEmpty && <FeedHealthBanner />}

      {!isEmpty && (
        <div className="relative">
          {sections.length > 0 && (
            <AgendaSticky sections={sections} now={now} layout={rows ? "rows" : "cards"} />
          )}
          {rows ? (
            <div className="flex flex-col gap-6">
              {todayLink}
              {rowSections.length > 0 && <AgendaRows sections={rowSections} />}
              {overdue.length > visibleOverdue.length && (
                <RevealOverdueButton
                  remaining={overdue.length - visibleOverdue.length}
                  onReveal={revealMoreOverdue}
                />
              )}
              {visibleGroups.length < groups.length && (
                <AgendaContinuation
                  key={`groups-${visibleGroups.length}`}
                  label="Load more days"
                  onReveal={revealMoreGroups}
                />
              )}
              {allGroupsVisible && visibleLater.length < later.length && (
                <AgendaContinuation
                  key={`later-${visibleLater.length}`}
                  label="Load more later items"
                  onReveal={revealMoreLater}
                />
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {visibleOverdue.length > 0 && (
                <section id="agenda-overdue" className="agenda-day">
                  <p className="mb-2.5 text-[12px] font-medium text-warn">Overdue · {overdue.length}</p>
                  <div className="flex flex-col gap-2">
                    <AnimatePresence initial={false}>
                      {visibleOverdue.map((item) => (
                        <ItemCard
                          key={item.id}
                          item={item}
                          category={item.categoryId ? categoriesById.get(item.categoryId) : undefined}
                          {...chrome}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                  {overdue.length > visibleOverdue.length && (
                    <RevealOverdueButton
                      remaining={overdue.length - visibleOverdue.length}
                      onReveal={revealMoreOverdue}
                    />
                  )}
                </section>
              )}

              {todayLink}

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

              {visibleGroups.length < groups.length && (
                <AgendaContinuation
                  key={`groups-${visibleGroups.length}`}
                  label="Load more days"
                  onReveal={revealMoreGroups}
                />
              )}

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
              {allGroupsVisible && visibleLater.length < later.length && (
                <AgendaContinuation
                  key={`later-${visibleLater.length}`}
                  label="Load more later items"
                  onReveal={revealMoreLater}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RevealOverdueButton({ remaining, onReveal }: { remaining: number; onReveal: () => void }) {
  return (
    <button
      type="button"
      onClick={onReveal}
      className="press-none mt-2 flex min-h-11 w-full items-center justify-center rounded-lg border border-line bg-surface text-[13px] font-medium text-ink-soft transition-colors duration-[var(--motion-standard)] hover:border-line-strong hover:text-ink"
    >
      Show {Math.min(remaining, OVERDUE_PAGE_SIZE)} more overdue
    </button>
  );
}

function AgendaContinuation({ label, onReveal }: { label: string; onReveal: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onReveal();
      },
      { rootMargin: "360px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [onReveal]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onReveal}
      className="press-none flex min-h-11 w-full items-center justify-center rounded-lg text-[12.5px] font-medium text-ink-faint transition-colors duration-[var(--motion-standard)] hover:bg-surface-sunken/60 hover:text-ink-soft"
    >
      {label}
    </button>
  );
}
