"use client";

import { useMemo, useState } from "react";
import { whenWord } from "@/lib/assistant-actions";
import { categoryLabel } from "@/lib/course-name";
import { useDatebookStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { Item } from "@/lib/types";

const STATUS: Record<NonNullable<Item["status"]>, string> = {
  todo: "To do",
  doing: "In progress",
  done: "Done",
};

/**
 * The user's own items as tappable rows, read live from the store by id.
 *
 * Both engines hand over ids, never formatted text, so a due date reads the same
 * whichever one answered, an item finished a moment ago shows as Done, and a
 * tap opens the real item rather than a sentence about it.
 */
export function AssistantItemRows({
  ids,
  heading,
  onOpen,
}: {
  ids: string[];
  heading?: string;
  onOpen: (id: string) => void;
}) {
  const items = useDatebookStore((s) => s.items);
  const categories = useDatebookStore((s) => s.categories);
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  // "Overdue" is judged when the rows are drawn; a chat row is not a clock.
  const [now] = useState(() => Date.now());
  const rows = useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    return ids.map((id) => byId.get(id)).filter((i): i is Item => Boolean(i));
  }, [ids, items]);
  if (!rows.length) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-sunken">
      {heading && (
        <p className="px-3 pt-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
          {heading}
        </p>
      )}
      <ul className="divide-y divide-line">
        {rows.map((item) => {
          const category = categories.find((c) => c.id === item.categoryId);
          const overdue =
            item.type !== "event" && item.status !== "done" && +new Date(item.at) < now;
          const status = item.type === "event" ? null : (item.status ?? "todo");
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpen(item.id)}
                aria-label={`Open ${item.title}`}
                className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface"
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: category?.color ?? "var(--ink-faint)" }}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-[14px] font-medium text-ink",
                      item.status === "done" && "text-ink-faint line-through",
                    )}
                  >
                    {item.title}
                  </span>
                  <span className="block truncate text-[12px] text-ink-faint">
                    {whenWord(item.at, { type: item.type, allDay: item.allDay, clock24h })}
                    {category ? ` · ${categoryLabel(categories, category)}` : ""}
                  </span>
                </span>
                {status && (
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      overdue
                        ? "bg-warn/15 text-warn"
                        : status === "done"
                          ? "bg-good/15 text-good"
                          : status === "doing"
                            ? "bg-accent-soft text-accent"
                            : "bg-surface text-ink-faint",
                    )}
                  >
                    {overdue ? "Overdue" : STATUS[status]}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
