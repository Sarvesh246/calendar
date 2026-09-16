"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMediaQuery } from "@/lib/use-media-query";
import Link from "next/link";
import { AnimatePresence } from "framer-motion";
import { Bell, CalendarClock, Link2, Minimize2, TriangleAlert } from "lucide-react";
import { haptic } from "@/lib/haptic";
import { prefersReducedMotion } from "@/lib/motion";
import { addDays, differenceInCalendarDays, format, startOfDay } from "date-fns";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useFilterBreakdown, useFilteredItems } from "@/lib/use-filtered-items";
import { findOverlapGroups } from "@/lib/overlap";
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
import { handleItemMenuKey, itemMenuProps } from "@/lib/item-menu";
import { UpNextStack } from "@/components/up-next-card";
import { ItemCard } from "@/components/item-card";
import { ListEmptyState } from "@/components/list-empty-state";
import { OverlapNotices } from "@/components/overlap-notice";
import { FocusSessionChip } from "@/components/focus-session-chip";
import { isSessionLive } from "@/lib/focus-session";
import { openFocusRoom, useFocusSessionStore } from "@/lib/focus-session-store";
import { OnboardingCard } from "@/components/onboarding-card";
import { FeedHealthBanner } from "@/components/feed-health-banner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Category, Item } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { isClassMeeting } from "@/lib/class-schedule";
import { notificationPermission } from "@/lib/reminders";
import { useHasMounted } from "@/lib/use-has-mounted";

/** From here up Today splits into a main column and a supporting one. */
const WIDE_QUERY = "(min-width: 1280px)";
const COMING_UP_DAYS = 7;
const COMING_UP_ROWS = 8;

export default function TodayPage() {
  return <TodayDashboard />;
}

/** Open work and events after today within the coming week, soonest first. */
function comingUpItems(items: Item[], day: Date): Item[] {
  const from = addDays(startOfDay(day), 1).getTime();
  const to = addDays(startOfDay(day), COMING_UP_DAYS + 1).getTime();
  return items
    .filter((i) => {
      if (i.workFor) return false;
      if (i.type !== "event" && i.status === "done") return false;
      const t = new Date(i.at).getTime();
      return t >= from && t < to;
    })
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

function TodayDashboard() {
  const router = useRouter();
  const mobile = useMediaQuery("(max-width: 767px)");
  const wide = useMediaQuery(WIDE_QUERY);
  const [reviewOverdue, setReviewOverdue] = useState(false);
  const items = useFilteredItems();
  const allItems = useDatebookStore((s) => s.items);
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const categories = useDatebookStore((s) => s.categories);
  const classReminderMinutes = useDatebookStore((s) => s.settings.classReminderMinutes);
  const chrome = useItemCardChrome();
  const categoriesById = useCategoriesById();
  const session = useFocusSessionStore((s) => s.session);
  const liveSession = isSessionLive(session);

  const now = useNow();
  const todayKey = dayKey(now);
  const day = useMemo(() => startOfDay(new Date(`${todayKey}T12:00:00`)), [todayKey]);

  const dk = dayKey(day);
  const today = useMemo(() => itemsOnDay(items, day), [items, dk]); // eslint-disable-line react-hooks/exhaustive-deps
  const comingUp = useMemo(() => comingUpItems(items, day), [items, dk]); // eslint-disable-line react-hooks/exhaustive-deps
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

  // Measured against the *unfiltered* day, so "Clear day" can never be a filter
  // in disguise and the empty state can name whichever filter emptied it.
  const todayAll = useMemo(() => itemsOnDay(allItems, day), [allItems, day]);
  const todayBreakdown = useFilterBreakdown(todayAll);
  const overlaps = useMemo(() => findOverlapGroups(todayList, day), [todayList, day]);

  const header = (
    <header className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[13px] font-medium text-ink-faint">{greeting.label}</p>
        <h1 className="mt-0.5 text-[26px] font-semibold leading-tight tracking-tight text-ink sm:text-[28px]">
          {format(day, "EEEE, MMMM d")}
        </h1>
        <p className="mt-1 text-[14px] text-ink-soft">
          {formatDaySummary(
            eventsCount,
            dueTodayCount,
            // The attention strip right below says this, in more detail and with
            // a way to act on it. Saying it twice makes the headline noise.
            mobile ? 0 : overdue.length,
            todayBreakdown.hiddenByCategory +
              todayBreakdown.hiddenByCompletion +
              todayBreakdown.hiddenByView
          )}
        </p>
      </div>
      {liveSession ? (
        <FocusSessionChip className="md:hidden" />
      ) : (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            haptic("light");
            openFocusRoom(undefined, router);
          }}
          aria-label="Focus"
          className="shrink-0 gap-1.5"
        >
          <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.9} />
          <span className="hidden min-[400px]:inline">Focus</span>
        </Button>
      )}
    </header>
  );

  const happening = (
    <HappeningNowSection
      items={items}
      categories={categories}
      classReminderMinutes={classReminderMinutes}
      clock24h={clock24h}
    />
  );

  // When nothing is live, Today’s list leads; Happening Now (upcoming) follows.
  const liveNow = useMemo(
    () => happeningNowStack(items, now, categories, classCountdownWindowMs(classReminderMinutes)),
    [items, now, categories, classReminderMinutes]
  );
  const hasLive = liveNow.happening.length > 0 || liveNow.startingSoon.length > 0;

  /**
   * What needs attention, in one line, above the day.
   *
   * On phone the overdue *cards* stay behind Review — the strip names the
   * backlog without pushing today's schedule below the fold. Desktop still
   * shows the cards up front.
   */
  const attentionStrip = mobile && overdue.length > 0 && (
    <button
      type="button"
      onClick={() => {
        haptic("light");
        setReviewOverdue(true);
        // Next paint hosts #today-overdue; scroll after Review reveals it.
        requestAnimationFrame(() => {
          document
            .getElementById("today-overdue")
            ?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
        });
      }}
      className="press-none flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-warn/40 bg-warn-soft px-3 text-left"
    >
      <TriangleAlert className="h-4 w-4 shrink-0 text-warn" strokeWidth={2} aria-hidden />
      <span className="min-w-0 flex-1 text-[13px] font-medium text-warn">
        {overdue.length} overdue
        <span className="font-normal opacity-80"> · {overdueAgeLabel(overdue, now)}</span>
      </span>
      <span className="shrink-0 text-[12.5px] font-semibold text-warn">
        {reviewOverdue ? "Hide" : "Review"}
      </span>
    </button>
  );

  const overdueSection = overdue.length > 0 && (!mobile || reviewOverdue) && (
    <section id="today-overdue" className="scroll-mt-[calc(var(--mobile-header-height)+0.75rem)]">
      <div className="flex items-center justify-between">
        <SectionLabel>Overdue · {overdue.length}</SectionLabel>
        {mobile && (
          <button
            type="button"
            className="min-h-11 px-2 text-[13px] font-medium text-accent"
            onClick={() => setReviewOverdue(false)}
          >
            Hide
          </button>
        )}
      </div>
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
  );

  const todaySection = (
    <section>
      <SectionLabel>Today</SectionLabel>
      {todayList.length === 0 ? (
        <>
          <ListEmptyState
            scope="today"
            total={todayBreakdown.total}
            hiddenByCategory={todayBreakdown.hiddenByCategory}
            hiddenByCompletion={todayBreakdown.hiddenByCompletion}
            hiddenByView={todayBreakdown.hiddenByView}
          />
          <PostOnboardingImportTip empty={todayBreakdown.total === 0} />
        </>
      ) : (
        <div className="flex flex-col gap-2">
          {/* Two classes at the same hour read as "first this, then that" in a
              list. On a phone that sentence is the only warning there is. */}
          <OverlapNotices groups={overlaps} className="md:hidden" />
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
  );

  const comingUpSection = (
    <section>
      <SectionLabel>Coming up{comingUp.length ? ` · ${comingUp.length}` : ""}</SectionLabel>
      {comingUp.length === 0 ? (
        <Link
          href="/agenda"
          className="press-none flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-[13px] text-ink-soft transition-colors hover:border-line-strong hover:bg-surface-sunken/50"
        >
          <span>Nothing in the next {COMING_UP_DAYS} days</span>
          <span className="font-medium text-ink">Open agenda</span>
        </Link>
      ) : (
        <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface">
          {comingUp.slice(0, COMING_UP_ROWS).map((item) => {
            const at = new Date(item.at);
            const isTomorrow = dayKey(at) === dayKey(addDays(day, 1));
            const dayLabel = isTomorrow
              ? "Tomorrow"
              : format(at, "EEE");
            return (
              <CompactRow
                key={item.id}
                item={item}
                category={item.categoryId ? categoriesById.get(item.categoryId) : undefined}
                trailing={`${dayLabel}${item.allDay ? "" : ` ${formatTime(item.at, clock24h)}`}`}
              />
            );
          })}
          <Link
            href="/agenda"
            className="border-t border-line px-4 py-2.5 text-[12px] font-medium text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            {comingUp.length > COMING_UP_ROWS
              ? `And ${comingUp.length - COMING_UP_ROWS} more on the agenda`
              : "Open agenda"}
          </Link>
        </div>
      )}
    </section>
  );

  if (wide) {
    // What you're doing today leads; what's live and what's next supports it.
    return (
      <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6">
        <OnboardingCard />
        <FeedHealthBanner />
        {header}
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(300px,368px)] items-start gap-6">
          <div className="flex min-w-0 flex-col gap-6">
            {overdueSection}
            {todaySection}
          </div>
          <aside
            aria-label="Coming up"
            className="sticky top-4 flex max-h-[calc(100dvh-2rem)] min-w-0 flex-col gap-6 overflow-y-auto overscroll-contain [scrollbar-width:thin]"
          >
            {happening}
            {comingUpSection}
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-4 sm:gap-6">
      <OnboardingCard />
      <FeedHealthBanner />
      {header}
      {attentionStrip}
      {/* Live class first when something is happening; otherwise the day list
          leads so “nothing live” doesn’t bury Today under an upcoming card. */}
      {hasLive ? happening : todaySection}
      {hasLive ? todaySection : happening}
      {overdueSection}
      <TodayNextStepTips />
      {comingUpSection}
    </div>
  );
}

/** "oldest 4 days late", or "since yesterday" when it is only just late. */
function overdueAgeLabel(overdue: Item[], now: Date): string {
  let oldest = 0;
  for (const item of overdue) {
    const at = new Date(item.at).getTime();
    if (Number.isNaN(at)) continue;
    oldest = Math.max(oldest, differenceInCalendarDays(now, new Date(at)));
  }
  if (oldest <= 0) return "due earlier today";
  if (oldest === 1) return "since yesterday";
  return `oldest ${oldest} days late`;
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

/** After dismissing onboarding with an empty calendar, point at Import once. */
function PostOnboardingImportTip({ empty }: { empty: boolean }) {
  const mounted = useHasMounted();
  const dismissed = useDatebookStore((s) => s.settings.onboardingDismissed);
  const itemCount = useDatebookStore((s) => s.items.length);
  const sourceCount = useDatebookStore((s) => s.importSources.length);
  if (!mounted || !dismissed || !empty || itemCount > 0 || sourceCount > 0) return null;
  return (
    <Link
      href="/settings#import"
      className="mt-2 flex min-h-11 items-center justify-between gap-3 rounded-lg border border-dashed border-line px-3 text-[13px] text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Link2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        <span className="min-w-0 truncate">Import a calendar to fill Today</span>
      </span>
      <span className="shrink-0 font-medium text-accent">Import</span>
    </Link>
  );
}

/**
 * Lightweight chips when the calendar already has work but weekly meetings
 * and/or reminders are still missing — not a second onboarding card.
 */
function TodayNextStepTips() {
  const mounted = useHasMounted();
  const items = useDatebookStore((s) => s.items);
  const categories = useDatebookStore((s) => s.categories);
  const openClassSchedule = useUIStore((s) => s.openClassSchedule);
  const nameOf = (id?: string) => (id ? categories.find((c) => c.id === id)?.name : undefined);
  const hasMeetings = items.some((i) => isClassMeeting(i, nameOf(i.categoryId)));
  const remindersOff =
    mounted &&
    notificationPermission() !== "granted" &&
    notificationPermission() !== "unsupported";

  if (!mounted || items.length === 0) return null;
  if (hasMeetings && !remindersOff) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {!hasMeetings && (
        <button
          type="button"
          onClick={() => {
            haptic("light");
            openClassSchedule();
          }}
          className="press-none flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
        >
          <CalendarClock className="h-3.5 w-3.5" strokeWidth={1.9} />
          Add class times
        </button>
      )}
      {remindersOff && (
        <Link
          href="/settings#reminders"
          className="press-none flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
        >
          <Bell className="h-3.5 w-3.5" strokeWidth={1.9} />
          Turn on reminders
        </Link>
      )}
    </div>
  );
}

/** One line per item; opens the shared inspector, right-click for actions. */
function CompactRow({
  item,
  category,
  trailing,
}: {
  item: Item;
  category: Category | undefined;
  trailing: string;
}) {
  const openInspector = useUIStore((s) => s.openInspector);
  const status = item.type === "event" ? undefined : item.status ?? "todo";
  return (
    <button
      type="button"
      onClick={() => openInspector(item.id)}
      onKeyDown={(e) => handleItemMenuKey(e, item.id)}
      {...itemMenuProps(item.id)}
      className="flex items-center gap-3 border-t border-line px-4 py-2.5 text-left transition-colors duration-[var(--motion-micro)] first:border-t-0 hover:bg-surface-sunken/50 focus-visible:bg-surface-sunken/50 focus-visible:outline-none"
    >
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: category?.color ?? "#8a8a94" }}
      />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-[13px] font-medium",
            status === "done" ? "text-ink-soft line-through decoration-ink-faint" : "text-ink"
          )}
        >
          {item.title}
        </span>
        {status === "doing" && <span className="block text-[11.5px] text-accent">In progress</span>}
      </span>
      <span className="shrink-0 text-[12px] tabular-nums text-ink-faint">{trailing}</span>
    </button>
  );
}
