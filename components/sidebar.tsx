"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  CalendarDays,
  Cloud,
  CloudOff,
  ListChecks,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings,
  Sun,
} from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useAuth } from "./auth-provider";
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
          <SyncChip collapsed={collapsed} />
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

      {/* Mobile bottom nav — SyncChip lives only in the desktop rail.
          The outer wrapper carries the iOS safe-area inset so the pill floats
          clear of the home indicator; the pill itself stays a fixed height. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom)+0.7rem)] md:hidden">
        <div className="glass mx-auto flex max-w-md items-center justify-around rounded-2xl p-1.5">
          {[...NAV, { href: "/settings", label: "Settings", icon: Settings }].map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className="relative flex flex-1 flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[10.5px] font-medium transition-transform active:scale-[0.92]"
              >
                {active && (
                  <motion.span
                    layoutId="bottom-nav-active"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    className="absolute inset-0 rounded-xl bg-accent-soft"
                  />
                )}
                <Icon
                  className={cn(
                    "relative h-5 w-5 transition-colors",
                    active ? "text-accent" : "text-ink-faint"
                  )}
                  strokeWidth={1.9}
                />
                <span className={cn("relative transition-colors", active ? "text-accent" : "text-ink-faint")}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

function SyncChip({ collapsed }: { collapsed: boolean }) {
  const { configured, user } = useAuth();
  const syncStatus = useDatebookStore((s) => s.syncStatus);

  if (!configured) return null;

  let icon = <Cloud className="h-4 w-4 shrink-0" strokeWidth={1.9} />;
  let label = "Sign in to sync";
  let cls = "text-ink-soft hover:bg-surface-sunken hover:text-ink";

  if (user) {
    if (syncStatus === "syncing" || syncStatus === "connecting") {
      icon = <RefreshCw className="h-4 w-4 shrink-0 animate-spin" strokeWidth={1.9} />;
      label = "Syncing…";
    } else if (syncStatus === "error") {
      icon = <CloudOff className="h-4 w-4 shrink-0" strokeWidth={1.9} />;
      label = "Sync error";
      cls = "text-warn hover:bg-surface-sunken";
    } else {
      icon = <Cloud className="h-4 w-4 shrink-0" strokeWidth={1.9} />;
      label = "Synced";
      cls = "text-good hover:bg-surface-sunken";
    }
  } else if (user === undefined) {
    icon = <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={1.9} />;
    label = "…";
  }

  return (
    <Link
      href="/settings"
      title={label}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition-colors",
        cls
      )}
    >
      {icon}
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}
