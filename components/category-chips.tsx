"use client";

import { usePathname } from "next/navigation";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { cn } from "@/lib/utils";

export function CategoryChips() {
  const pathname = usePathname();
  const categories = useDatebookStore((s) => s.categories);
  const filter = useUIStore((s) => s.categoryFilter);
  const toggle = useUIStore((s) => s.toggleCategoryFilter);
  const clear = useUIStore((s) => s.clearCategoryFilter);
  const onCalendar = pathname === "/calendar";

  const visible = categories.filter((c) => !c.archived);
  if (visible.length === 0) return null;

  return (
    <div
      className={cn(
        "-mx-4 flex shrink-0 gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden",
        onCalendar ? "mb-2" : "mb-4"
      )}
    >
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
      {visible.map((cat) => {
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
