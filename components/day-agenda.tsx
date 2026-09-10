"use client";

import { Plus } from "lucide-react";
import { format } from "date-fns";
import { useCategory } from "@/lib/store";
import { dayLabel } from "@/lib/date-utils";
import { ItemCard } from "@/components/item-card";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Item } from "@/lib/types";

export function DayAgenda({
  date,
  items,
  onAdd,
  className,
}: {
  date: Date;
  items: Item[];
  onAdd?: () => void;
  className?: string;
}) {
  const label = dayLabel(date);
  const showDate = label === "Today" || label === "Tomorrow" || label === "Yesterday";

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="mb-3 flex shrink-0 items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-semibold text-ink">{label}</p>
          {showDate && (
            <p className="mt-0.5 text-[12px] text-ink-faint">{format(date, "EEEE, MMMM d")}</p>
          )}
        </div>
        {onAdd && (
          <Button variant="secondary" size="sm" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            Add
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <EmptyState title="Nothing scheduled." sub={`Free day on ${format(date, "MMM d")}.`} />
      ) : (
        <div className="-mr-1 min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-1">
          {/* Nested stack so cards keep intrinsic height. A flex-col scroller
              shrinks its children to fit, which squashed expanded editors. */}
          <div className="flex flex-col gap-2">
            {items.map((item) => (
              <div key={item.id} className="shrink-0">
                <DayAgendaRow item={item} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DayAgendaRow({ item }: { item: Item }) {
  const category = useCategory(item.categoryId);
  return <ItemCard item={item} category={category} />;
}
