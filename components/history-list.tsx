"use client";

import { startTransition, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { format, isToday, isYesterday, startOfDay } from "date-fns";
import { History, Search } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useDeferredCategoryFilter } from "@/lib/ui-store";
import { applyCategoryFilter } from "@/lib/filters";
import { useCategoriesById, useItemCardChrome } from "@/lib/card-chrome";
import { ItemCard } from "@/components/item-card";
import type { Item } from "@/lib/types";

const PAGE = 30;

/** When the item was finished; falls back to its due time for older data. */
export function completionTime(item: Item): number {
  const t = new Date(item.completedAt ?? item.statusAt ?? item.at).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function heading(day: Date): string {
  if (isToday(day)) return "Today";
  if (isYesterday(day)) return "Yesterday";
  return format(day, "EEEE, MMMM d");
}

/**
 * Everything you've finished, newest first. Each card is the normal card, so a
 * completed item can be put back to to do or in progress, opened, or just read.
 * The "hide completed" filter never applies here — this is where completed
 * work lives — but the class filter does.
 */
export function HistoryList() {
  const allItems = useDatebookStore((s) => s.items);
  const categoryFilter = useDeferredCategoryFilter();
  const chrome = useItemCardChrome();
  const categoriesById = useCategoriesById();
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const done = useMemo(
    () =>
      applyCategoryFilter(
        allItems.filter((i) => i.type !== "event" && i.status === "done"),
        categoryFilter
      ).sort((a, b) => completionTime(b) - completionTime(a)),
    [allItems, categoryFilter]
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return done;
    return done.filter((i) => {
      const cls = i.categoryId ? categoriesById.get(i.categoryId)?.name ?? "" : "";
      return `${i.title} ${cls}`.toLowerCase().includes(q);
    });
  }, [done, query, categoriesById]);

  const visible = matches.slice(0, limit);
  const groups = useMemo(() => {
    const out: { key: string; day: Date; items: Item[] }[] = [];
    for (const item of visible) {
      const day = startOfDay(new Date(completionTime(item)));
      const key = format(day, "yyyy-MM-dd");
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(item);
      else out.push({ key, day, items: [item] });
    }
    return out;
  }, [visible]);

  if (done.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line px-6 py-12 text-center">
        <History aria-hidden className="h-6 w-6 text-ink-faint" strokeWidth={1.75} />
        <p className="text-[15px] font-semibold text-ink">Nothing completed yet</p>
        <p className="max-w-[28ch] text-[13px] text-ink-soft">
          Work you mark done lands here, so you can always find it again.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <label className="relative block">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
          strokeWidth={1.9}
        />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
          placeholder={`Search ${done.length} completed`}
          aria-label="Search completed items"
          className="min-h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-[16px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
        />
      </label>

      {matches.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-ink-soft">No completed items match “{query.trim()}”.</p>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="agenda-day">
            <p className="mb-2.5 text-[12px] font-medium text-ink-faint">
              {heading(group.day)}
              <span className="font-normal"> · {group.items.length} done</span>
            </p>
            <div className="flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {group.items.map((item) => (
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
        ))
      )}

      {matches.length > visible.length && (
        <button
          type="button"
          onClick={() => startTransition(() => setLimit((n) => n + PAGE))}
          className="press-none flex min-h-11 w-full items-center justify-center rounded-lg border border-line bg-surface text-[13px] font-medium text-ink-soft transition-colors duration-[var(--motion-standard)] hover:border-line-strong hover:text-ink"
        >
          Show {Math.min(PAGE, matches.length - visible.length)} more
        </button>
      )}
    </div>
  );
}
