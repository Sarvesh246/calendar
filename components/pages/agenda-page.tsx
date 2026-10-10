"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { addDays, format, isTomorrow, startOfDay } from "date-fns";
import { LayoutList, Rows3 } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useFilterBreakdown, useFilteredItems } from "@/lib/use-filtered-items";
import { useWorkspacePrefs, type AgendaLayout } from "@/lib/workspace-prefs";
import { useMediaQuery } from "@/lib/use-media-query";
import { useCategoriesById, useItemCardChrome } from "@/lib/card-chrome";
import {
  dayKey,
  groupItemsByDay,
  isOverdue,
  isOverdueAt,
  itemOccupiesDay,
  openWorkDueOnDay,
  workDueOnDay,
} from "@/lib/date-utils";
import { ItemCard } from "@/components/item-card";
import { AgendaTodayDropdown } from "@/components/agenda-today";
import { HistoryList } from "@/components/history-list";
import { AgendaRows, type AgendaRowSection } from "@/components/agenda-rows";
import { AgendaSticky } from "@/components/agenda-sticky";
import type { AgendaStickySection } from "@/lib/agenda-sticky";
import { ListEmptyState } from "@/components/list-empty-state";
import { OnboardingCard } from "@/components/onboarding-card";
import { FeedHealthBanner } from "@/components/feed-health-banner";
import { AgendaWeek } from "@/components/agenda-week";
import { Segmented } from "@/components/ui/segmented";
import { categoryNameLookup, summarizeWeek } from "@/lib/agenda-week";
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

type AgendaView = "upcoming" | "history";
const VIEWS: { value: AgendaView; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "history", label: "History" },
];

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
  const categories = useDatebookStore((s) => s.categories);
  const desktop = useMediaQuery("(min-width: 768px)");
  const layout = useWorkspacePrefs((s) => s.agendaLayout);
  const setLayout = useWorkspacePrefs((s) => s.setAgendaLayout);
  const [view, setView] = useState<AgendaView>("upcoming");
  // Rows are a desk layout: they need the room for five aligned columns, so
  // anything narrower than a laptop (phones, tablets) gets cards.
  const wide = useMediaQuery("(min-width: 1024px)");
  const rows = wide && layout === "rows";

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

  // The whole of today for the dropdown: events, plus work due today with the
  // finished items kept (crossed out) so a completed day still reads back.
  const todayRows = useMemo(() => {
    const today = startOfDay(now);
    const events = items.filter((it) => it.type === "event" && itemOccupiesDay(it, today));
    const work = workDueOnDay(items, today);
    const byTime = (a: Item, b: Item) => new Date(a.at).getTime() - new Date(b.at).getTime();
    return [
      ...[...events, ...work.filter((i) => i.status !== "done")].sort(byTime),
      ...work.filter((i) => i.status === "done"),
    ];
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

  const week = useMemo(
    () => summarizeWeek(byDay, now, weekStartsOn, categoryNameLookup(categories)),
    [byDay, now, weekStartsOn, categories]
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

  // Fill the rest in while nothing is happening, one page per idle slice, so a
  // scroll never has to mount days on its way down — that mid-scroll render
  // was the Agenda's hitch. The sentinel below stays as the fallback for a
  // fling that outruns idle time. `content-visibility` keeps the extra days
  // nearly free until they're on screen.
  const pendingFill = !allGroupsVisible || visibleLater.length < later.length;
  useEffect(() => {
    if (!pendingFill) return;
    const fill = () => (allGroupsVisible ? revealMoreLater() : revealMoreGroups());
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(fill, { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(fill, 200);
    return () => window.clearTimeout(id);
  }, [pendingFill, allGroupsVisible, groupLimit, laterLimit, revealMoreGroups, revealMoreLater]);

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
    if (visibleOverdue.length) {
      out.push({ id: "overdue", label: "Overdue", count: overdue.length, tone: "warn", items: visibleOverdue });
    }
    for (const g of visibleGroups) {
      out.push({
        id: g.key,
        label: isTomorrow(g.date) ? "Tomorrow" : format(g.date, "EEEE"),
        sublabel: format(g.date, "MMM d"),
        count: g.items.length,
        tone: "faint",
        items: g.items,
        dayKey: g.key,
      });
    }
    if (visibleLater.length) {
      out.push({ id: "later", label: "Later", sublabel: `after ${format(addDays(startOfDay(now), HORIZON_DAYS - 1), "MMM d")}`, count: later.length, tone: "faint", items: visibleLater });
    }
    return out;
  }, [rows, overdue.length, later.length, visibleOverdue, visibleGroups, visibleLater, now]);

  const todayLink = <AgendaTodayDropdown items={todayRows} />;

  return (
    <div className={cn("mx-auto flex w-full flex-col gap-6", rows ? "max-w-[1080px]" : "max-w-[880px]")}>
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.015em] text-ink">Agenda</h1>
          <p className="mt-1 text-[13.5px] text-ink-soft">
            {view === "history" ? "What you've finished, most recent first." : "Everything ahead, one day at a time."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Segmented
            label="Agenda view"
            value={view}
            options={VIEWS}
            onChange={setView}
            size={desktop ? "desk" : "touch"}
            fill={!desktop}
            className="w-full md:w-auto"
          />
          {view === "upcoming" && (
            <Segmented
              label="Agenda layout"
              value={layout}
              options={LAYOUTS}
              onChange={setLayout}
              className="hidden lg:inline-flex"
            />
          )}
        </div>
      </header>

      {view === "history" ? (
        <div key="history" className="route-enter">
          <HistoryList />
        </div>
      ) : (
        <div key="upcoming" className="route-enter flex flex-col gap-6">
      <AgendaWeek
        days={week}
        onOpenDay={(d) => {
          setCalendarFocusDate(d.key);
          router.push("/calendar");
        }}
      />

      {isEmpty && (
        <>
          {todayLink}
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
                  <DayHeading label="Overdue" count={overdue.length} tone="warn" />
                  <div className="flex flex-col gap-2">
                    <AnimatePresence initial={false}>
                      {visibleOverdue.map((item) => (
                        <ItemCard
                          key={item.id}
                          item={item}
                          category={item.categoryId ? categoriesById.get(item.categoryId) : undefined}
                          showQuickActions={false}
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
                return (
                  <section key={group.key} id={`agenda-${group.key}`} className="agenda-day">
                    <DayHeading
                      label={isTomorrow(group.date) ? "Tomorrow" : format(group.date, "EEEE")}
                      sublabel={format(group.date, "MMM d")}
                      count={group.items.length}
                    />
                    <div className="flex flex-col gap-2">
                      <AnimatePresence initial={false}>
                        {group.items.map((item) => (
                          <ItemCard
                            key={item.id}
                            item={item}
                            category={item.categoryId ? categoriesById.get(item.categoryId) : undefined}
                            day={group.date}
                            showQuickActions={false}
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
                  <DayHeading label="Later" count={later.length} />
                  <div className="flex flex-col gap-2">
                    <AnimatePresence initial={false}>
                      {visibleLater.map((item) => (
                        <ItemCard
                          key={item.id}
                          item={item}
                          category={item.categoryId ? categoriesById.get(item.categoryId) : undefined}
                          showQuickActions={false}
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
      )}
    </div>
  );
}

/** Date group heading for the card layout — same words as the rows table. */
function DayHeading({
  label,
  sublabel,
  count,
  tone = "faint",
}: {
  label: string;
  sublabel?: string;
  count: number;
  tone?: "warn" | "faint";
}) {
  return (
    <h2 className="mb-2.5 flex items-baseline gap-2 px-0.5 text-[13px]">
      <span className={cn("font-semibold", tone === "warn" ? "text-warn" : "text-ink")}>{label}</span>
      {sublabel && <span className="text-ink-faint">{sublabel}</span>}
      <span className="ml-auto text-[12px] tabular-nums text-ink-faint">
        {count} {count === 1 ? "item" : "items"}
      </span>
    </h2>
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
      { rootMargin: "1200px 0px" }
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
