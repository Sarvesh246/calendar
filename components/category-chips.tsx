"use client";

import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { cn } from "@/lib/utils";

export function CategoryChips() {
  const categories = useDatebookStore((s) => s.categories);
  const filter = useUIStore((s) => s.categoryFilter);
  const toggle = useUIStore((s) => s.toggleCategoryFilter);
  const clear = useUIStore((s) => s.clearCategoryFilter);

  if (categories.length === 0) return null;

  return (
    <div className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden">
      <button
        type="button"
        onClick={clear}
        className={cn(
          "shrink-0 rounded-full px-3 py-2 text-[12.5px] font-medium transition-colors",
          !filter ? "bg-accent text-accent-ink" : "bg-surface-sunken text-ink-soft"
        )}
      >
        All
      </button>
      {categories.map((cat) => {
        const active = filter?.includes(cat.id) ?? false;
        return (
          <button
            key={cat.id}
            type="button"
            onClick={() => toggle(cat.id)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-[12.5px] font-medium transition-colors",
              active ? "bg-accent-soft text-ink" : "bg-surface-sunken text-ink-soft"
            )}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: cat.color }} />
            {cat.name}
          </button>
        );
      })}
    </div>
  );
}
