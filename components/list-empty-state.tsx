"use client";

import { startTransition } from "react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { describeEmptyState, type EmptyStateInput } from "@/lib/empty-state-copy";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { haptic } from "@/lib/haptic";

/**
 * An empty list that says which kind of empty it is, and offers the way out.
 *
 * Every list in the app used to render the same "Nothing scheduled." whether
 * the day was free, finished, or filtered into invisibility — the third of
 * which is the one people mistake for a broken app. The wording lives in
 * `lib/empty-state-copy.ts`; this is the part that knows how to undo it.
 */
export function ListEmptyState({
  scope,
  total,
  hiddenByCategory,
  hiddenByCompletion,
  hiddenByView,
  canAdd = false,
  onAdd,
  compact,
  className,
}: EmptyStateInput & {
  onAdd?: () => void;
  compact?: boolean;
  className?: string;
}) {
  const clearAllFilters = useUIStore((s) => s.clearAllFilters);
  const updateSettings = useDatebookStore((s) => s.updateSettings);

  const copy = describeEmptyState({
    scope,
    total,
    hiddenByCategory,
    hiddenByCompletion,
    hiddenByView,
    canAdd: canAdd && Boolean(onAdd),
  });

  return (
    <EmptyState
      title={copy.title}
      sub={copy.sub}
      compact={compact}
      className={className}
      action={
        copy.action === "clear-filters" ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              haptic("light");
              // Every filter, because the message just counted them all.
              // Clearing one and leaving the list still empty is worse than
              // not offering a way out at all.
              clearAllFilters();
              startTransition(() => updateSettings({ hideCompleted: false }));
            }}
          >
            Clear filters
          </Button>
        ) : copy.action === "show-completed" ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              haptic("light");
              startTransition(() => updateSettings({ hideCompleted: false }));
            }}
          >
            Show completed
          </Button>
        ) : copy.action === "add" && onAdd ? (
          <Button variant="secondary" size="sm" onClick={onAdd}>
            Add something
          </Button>
        ) : undefined
      }
    />
  );
}
