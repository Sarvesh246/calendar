"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
} from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/today", label: "Today", icon: Sun },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/agenda", label: "Agenda", icon: ListChecks },
];

export function Sidebar() {
  const pathname = usePathname();
  const categories = useDatebookStore((s) => s.categories);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useUIStore((s) => s.setSidebarCollapsed);
  const categoryFilter = useUIStore((s) => s.categoryFilter);
  const toggleCategoryFilter = useUIStore((s) => s.toggleCategoryFilter);

  return (
    <>
      {/* Desktop floating sidebar */}
      <aside
        className={cn(
          "sticky top-4 hidden h-[calc(100dvh-2.5rem)] shrink-0 flex-col gap-1 self-start overflow-y-auto rounded-xl border border-line bg-surface p-3 shadow-[var(--shadow-sm)] transition-[width] duration-200 md:flex",
          collapsed ? "w-[68px]" : "w-[220px]"
        )}
      >
        <div className="flex items-center justify-between px-1 py-1.5">
          {!collapsed && <span className="font-display text-[17px] italic text-ink">Datebook</span>}
          <button
            onClick={() => setSidebarCollapsed(!collapsed)}
            className="ml-auto rounded-md p-1.5 text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        <nav className="mt-2 flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors",
                  active ? "bg-accent text-accent-ink" : "text-ink-soft hover:bg-surface-sunken hover:text-ink"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                {!collapsed && item.label}
              </Link>
            );
          })}
        </nav>

        {!collapsed && (
          <div className="mt-6 flex flex-col gap-0.5">
            <p className="px-2.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
              Categories
            </p>
            {categories.map((cat) => {
              const active = categoryFilter?.includes(cat.id) ?? false;
              return (
                <button
                  key={cat.id}
                  onClick={() => toggleCategoryFilter(cat.id)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors",
                    active ? "bg-surface-sunken text-ink" : "text-ink-soft hover:bg-surface-sunken hover:text-ink"
                  )}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cat.color }} />
                  <span className="truncate">{cat.name}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-auto flex flex-col gap-0.5">
          <Link
            href="/settings"
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors",
              pathname === "/settings" ? "bg-accent text-accent-ink" : "text-ink-soft hover:bg-surface-sunken hover:text-ink"
            )}
          >
            <Settings className="h-4 w-4 shrink-0" strokeWidth={1.9} />
            {!collapsed && "Settings"}
          </Link>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="glass fixed inset-x-3 bottom-3 z-40 flex items-center justify-around rounded-xl px-2 py-2 md:hidden">
        {[...NAV, { href: "/settings", label: "Settings", icon: Settings }].map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 text-[10.5px] font-medium transition-colors",
                active ? "text-accent" : "text-ink-faint"
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={1.9} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
