"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
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
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/today", label: "Today", icon: Sun },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/agenda", label: "Agenda", icon: ListChecks },
];

/**
 * Labels in the collapsing rail. Previously these were `{!collapsed && label}`,
 * so the text vanished in one frame and *then* the rail spent 200ms narrowing —
 * two separate events for what should read as one. Fading and sliding them out
 * on the same timing as the width makes it a single gesture.
 */
function RailLabel({ collapsed, children }: { collapsed: boolean; children: React.ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {!collapsed && (
        <motion.span
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -6 }}
          transition={{ duration: motionTokens.micro, ease: motionTokens.ease }}
          className="truncate whitespace-nowrap"
        >
          {children}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const mobileActiveIndex = NAV.findIndex((i) => i.href === pathname);
  const categories = useDatebookStore((s) => s.categories);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useUIStore((s) => s.setSidebarCollapsed);
  const categoryFilter = useUIStore((s) => s.categoryFilter);
  const toggleCategoryFilter = useUIStore((s) => s.toggleCategoryFilter);

  return (
    <>
      {/* Desktop floating sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 68 : 220 }}
        transition={motionTokens.springLayout}
        className="sticky top-4 hidden h-[calc(100dvh-2.5rem)] shrink-0 flex-col gap-1 self-start overflow-y-auto overflow-x-hidden rounded-xl border border-line bg-surface p-3 shadow-[var(--shadow-sm)] md:flex"
      >
        <div className="flex items-center justify-between px-1 py-1.5">
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: motionTokens.micro, ease: motionTokens.ease }}
                className="font-display whitespace-nowrap text-[17px] italic text-ink"
              >
                Datebook
              </motion.span>
            )}
          </AnimatePresence>
          <button
            onClick={() => setSidebarCollapsed(!collapsed)}
            className="hover-lift ml-auto rounded-md p-1.5 text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        <nav className="mt-2 flex flex-col gap-0.5">
          {NAV.map((item) => (
            <RailLink
              key={item.href}
              href={item.href}
              label={item.label}
              Icon={item.icon}
              active={pathname === item.href}
              collapsed={collapsed}
            />
          ))}
        </nav>

        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: motionTokens.micro }}
              className="mt-6 flex flex-col gap-0.5"
            >
              <p className="px-2.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
                Categories
              </p>
              {categories
                .filter((c) => !c.archived)
                .map((cat) => {
                  const active = categoryFilter?.includes(cat.id) ?? false;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => toggleCategoryFilter(cat.id)}
                      aria-pressed={active}
                      className={cn(
                        "press-none group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px]",
                        "transition-colors duration-[var(--motion-standard)]",
                        active ? "bg-surface-sunken text-ink" : "text-ink-soft hover:bg-surface-sunken hover:text-ink"
                      )}
                    >
                      {/* The dot doubles as the on/off indicator: filled and full
                          size when the filter is on, hollow and small when off.
                          Colour alone was doing that job and read as decoration. */}
                      <motion.span
                        aria-hidden
                        initial={false}
                        animate={{ scale: active ? 1 : 0.72 }}
                        transition={motionTokens.springSnappy}
                        className="h-2 w-2 shrink-0 rounded-full ring-2 ring-transparent transition-[box-shadow]"
                        style={{
                          background: cat.color,
                          boxShadow: active ? `0 0 0 3px color-mix(in srgb, ${cat.color} 22%, transparent)` : "none",
                        }}
                      />
                      <span className="truncate">{cat.name}</span>
                    </button>
                  );
                })}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-auto flex flex-col gap-0.5">
          <SyncChip collapsed={collapsed} />
          <RailLink
            href="/settings"
            label="Settings"
            Icon={Settings}
            active={pathname === "/settings"}
            collapsed={collapsed}
          />
        </div>
      </motion.aside>

      {/* Mobile bottom nav — SyncChip lives only in the desktop rail.
          The outer wrapper carries the iOS safe-area inset so the pill floats
          clear of the home indicator; the pill itself stays a fixed height.

          The active pill is one element positioned by the active tab's index
          and animated on `x`. An earlier version gave each tab its own
          `layoutId` span that mounted/unmounted on navigation — framer then had
          to match across a changing DOM, and a disturbed measurement (the
          press-scale on the parent `<Link>`, a mid-transition route change)
          made it lurch in from the bottom instead of sliding across. A single
          transform-animated element has nothing to mismeasure. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(env(safe-area-inset-bottom),0.6rem)] md:hidden">
        <div className="glass relative mx-auto flex max-w-md items-stretch rounded-2xl p-1.5">
          {mobileActiveIndex >= 0 && (
            <motion.span
              aria-hidden
              className="pointer-events-none absolute inset-y-1.5 left-1.5 rounded-xl bg-accent-soft"
              style={{ width: `calc((100% - 0.75rem) / ${NAV.length})` }}
              initial={false}
              animate={{ x: `${mobileActiveIndex * 100}%` }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
            />
          )}
          {NAV.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={() => haptic("light")}
                className="press-none relative z-10 flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] font-medium"
              >
                {/* The icon lifts a hair when its tab becomes active — enough to
                    make the tap feel answered on top of the sliding pill. */}
                <motion.span
                  initial={false}
                  animate={{ y: active ? -1 : 0, scale: active ? 1.06 : 1 }}
                  transition={motionTokens.springSnappy}
                >
                  <Icon
                    className={cn(
                      "h-5 w-5 transition-colors duration-[var(--motion-standard)]",
                      active ? "text-accent" : "text-ink-faint"
                    )}
                    strokeWidth={1.9}
                  />
                </motion.span>
                <span
                  className={cn(
                    "transition-colors duration-[var(--motion-standard)]",
                    active ? "text-accent" : "text-ink-faint"
                  )}
                >
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

/**
 * A desktop rail destination. The active background is a shared `layoutId`
 * element, so moving between pages slides one pill down the rail instead of
 * cross-fading two blocks of colour — the same language the mobile bar already
 * spoke, which the rail was missing.
 */
function RailLink({
  href,
  label,
  Icon,
  active,
  collapsed,
}: {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  active: boolean;
  collapsed: boolean;
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "press-none relative flex items-center gap-2.5 overflow-hidden rounded-lg px-2.5 py-2 text-[13.5px] font-medium",
        "transition-colors duration-[var(--motion-standard)]",
        active ? "text-accent-ink" : "text-ink-soft hover:bg-surface-sunken hover:text-ink"
      )}
    >
      {active && (
        <motion.span
          layoutId="rail-active"
          aria-hidden
          className="absolute inset-0 rounded-lg bg-accent"
          transition={motionTokens.spring}
        />
      )}
      <Icon className="relative z-[1] h-4 w-4 shrink-0" strokeWidth={1.9} />
      <span className="relative z-[1] flex min-w-0">
        <RailLabel collapsed={collapsed}>{label}</RailLabel>
      </span>
    </Link>
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
        "press-none flex items-center gap-2.5 overflow-hidden rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium",
        "transition-colors duration-[var(--motion-standard)]",
        cls
      )}
    >
      {icon}
      <span className="flex min-w-0">
        <RailLabel collapsed={collapsed}>{label}</RailLabel>
      </span>
    </Link>
  );
}
