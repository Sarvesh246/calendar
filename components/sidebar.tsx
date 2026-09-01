"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, animate, useMotionValue } from "framer-motion";
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
import {
  beginTabDrag,
  endTabDrag,
  prepareTabTransition,
  snapTabIndex,
  tabPageX,
  tabTransition,
} from "@/lib/tab-swipe";
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
        className="sticky top-4 hidden h-[calc(100dvh-2.5rem)] shrink-0 flex-col gap-1 self-start overflow-y-auto overflow-x-hidden rounded-xl border border-line bg-surface p-3 md:flex"
      >
        <div className="flex items-center justify-between px-1 py-1.5">
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: motionTokens.micro, ease: motionTokens.ease }}
                className="whitespace-nowrap text-[17px] font-semibold text-ink"
              >
                Datebook
              </motion.span>
            )}
          </AnimatePresence>
          <button
            onClick={() => setSidebarCollapsed(!collapsed)}
            className="ml-auto rounded-md p-1.5 text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink"
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

      <MobileBottomNav pathname={pathname} />
    </>
  );
}

const pillSpring = { type: "spring" as const, stiffness: 420, damping: 36, mass: 0.65 };
const pageSpring = { type: "spring" as const, stiffness: 420, damping: 38, mass: 0.7 };

/** Swipeable bottom tab bar — drag left/right to move between main views. */
function MobileBottomNav({ pathname }: { pathname: string }) {
  const router = useRouter();
  const navRef = useRef<HTMLDivElement>(null);
  const [navWidth, setNavWidth] = useState(0);
  const activeIndex = Math.max(0, NAV.findIndex((i) => i.href === pathname));
  const pillX = useMotionValue(0);
  const pillScale = useMotionValue(1);
  const dragging = useRef(false);
  const navigating = useRef(false);
  const pointerId = useRef<number | null>(null);
  const startX = useRef(0);
  const indexAtStart = useRef(activeIndex);
  const didDrag = useRef(false);
  const pillInset = 4;
  const trackWidth = Math.max(0, navWidth - pillInset * 2);
  const tabWidth = trackWidth / NAV.length;

  useEffect(() => {
    NAV.forEach((item) => {
      if (item.href !== pathname) router.prefetch(item.href);
    });
  }, [pathname, router]);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNavWidth(el.clientWidth));
    ro.observe(el);
    setNavWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!tabWidth) return;
    const target = pillInset + activeIndex * tabWidth;
    if (dragging.current || navigating.current) {
      navigating.current = false;
      return;
    }
    pillX.set(target);
    indexAtStart.current = activeIndex;
  }, [activeIndex, tabWidth, pillX]);

  function pageOffsetFor(dx: number) {
    if (!tabWidth) return 0;
    return -(dx / tabWidth) * (typeof globalThis.innerWidth === "number" ? globalThis.innerWidth : 0);
  }

  function navigateTo(index: number, currentPageX = 0) {
    if (index === activeIndex) return;
    navigating.current = true;
    haptic("light");
    prepareTabTransition(activeIndex, index, currentPageX);
    if (tabWidth) {
      void animate(pillX, pillInset + index * tabWidth, pillSpring);
    }
    void animate(tabPageX, tabTransition.exitX, pageSpring);
    router.push(NAV[index].href);
  }

  function finishGesture() {
    if (!dragging.current) return;
    dragging.current = false;
    pointerId.current = null;
    void animate(pillScale, 1, pillSpring);

    if (!didDrag.current || !tabWidth) {
      endTabDrag();
      tabPageX.set(0);
      return;
    }

    const origin = pillInset + indexAtStart.current * tabWidth;
    const dx = pillX.get() - origin;
    const clamped = snapTabIndex(indexAtStart.current, dx, tabWidth, NAV.length);

    if (clamped !== activeIndex) {
      navigateTo(clamped, tabPageX.get());
      return;
    }

    endTabDrag();
    void Promise.all([
      animate(pillX, pillInset + activeIndex * tabWidth, pillSpring),
      animate(tabPageX, 0, pageSpring),
    ]);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || !tabWidth) return;
    dragging.current = true;
    didDrag.current = false;
    navigating.current = false;
    pointerId.current = e.pointerId;
    startX.current = e.clientX;
    indexAtStart.current = activeIndex;
    pillX.set(pillInset + activeIndex * tabWidth);
    tabPageX.set(0);
    beginTabDrag(pathname);
    void animate(pillScale, 1.015, pillSpring);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current || pointerId.current !== e.pointerId || !tabWidth) return;
    const dx = e.clientX - startX.current;
    if (Math.abs(dx) > 6) didDrag.current = true;
    const min = -(indexAtStart.current * tabWidth);
    const max = (NAV.length - 1 - indexAtStart.current) * tabWidth;
    const clamped = Math.max(min, Math.min(max, dx));
    pillX.set(pillInset + indexAtStart.current * tabWidth + clamped);
    tabPageX.set(pageOffsetFor(clamped));
  }

  function onPointerUp(e: React.PointerEvent) {
    if (pointerId.current !== e.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    finishGesture();
  }

  function onPointerCancel() {
    finishGesture();
  }

  return (
    <nav
      className="mobile-bottom-nav fixed inset-x-0 z-40 px-3 md:hidden"
      style={{
        bottom: "var(--vv-bottom, 0px)",
        paddingBottom: "max(var(--safe-bottom, env(safe-area-inset-bottom, 0px)), 0.6rem)",
      }}
    >
      <div
        ref={navRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        className="mobile-tab-bar relative mx-auto flex max-w-md touch-none select-none items-stretch rounded-full p-1"
      >
        {navWidth > 0 && (
          <motion.span
            aria-hidden
            className="mobile-tab-pill pointer-events-none absolute inset-y-1 left-0"
            style={{ width: tabWidth, x: pillX, scale: pillScale }}
          />
        )}
        {NAV.map((item, index) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <a
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                if (didDrag.current) {
                  didDrag.current = false;
                  return;
                }
                if (index !== activeIndex) {
                  endTabDrag();
                  tabPageX.set(0);
                  navigateTo(index, 0);
                } else {
                  haptic("light");
                }
              }}
              className="press-none relative z-10 flex min-h-[48px] flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-1 py-1 text-[10.5px] font-medium tracking-[0.01em]"
            >
              <Icon
                className={cn(
                  "h-[22px] w-[22px] transition-colors duration-[var(--motion-standard)]",
                  active ? "text-accent" : "text-ink-faint"
                )}
                strokeWidth={active ? 2.1 : 1.85}
              />
              <span
                className={cn(
                  "transition-colors duration-[var(--motion-standard)]",
                  active ? "font-semibold text-ink" : "text-ink-faint"
                )}
              >
                {item.label}
              </span>
            </a>
          );
        })}
      </div>
    </nav>
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
