"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, animate, useMotionValue, useTransform } from "framer-motion";
import {
  CalendarDays,
  Sparkles,
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
  const categories = useDatebookStore((s) => s.categories);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useUIStore((s) => s.setSidebarCollapsed);
  const setAIDrawerOpen = useUIStore((s) => s.setAIDrawerOpen);
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
          {/* Sits with the views rather than buried in a menu — it's a place you
              go, not a setting you find. */}
          <RailButton
            label="Assistant"
            Icon={Sparkles}
            collapsed={collapsed}
            onClick={() => setAIDrawerOpen(true)}
          />
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

/** Swipeable bottom tab bar — drag left/right to move between main views. */
function MobileBottomNav({ pathname }: { pathname: string }) {
  const router = useRouter();
  const navRef = useRef<HTMLDivElement>(null);
  const [navWidth, setNavWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const activeIndex = Math.max(0, NAV.findIndex((i) => i.href === pathname));
  const dragX = useMotionValue(0);
  const baseX = useMotionValue(0);
  const dragging = useRef(false);
  const pointerId = useRef<number | null>(null);
  const startX = useRef(0);
  const indexAtStart = useRef(activeIndex);
  const didDrag = useRef(false);

  const pillInset = 4;
  const trackWidth = Math.max(0, navWidth - pillInset * 2);
  const tabWidth = trackWidth / NAV.length;
  const pillX = useTransform([baseX, dragX], ([b, d]) => pillInset + (b as number) + (d as number));

  // Mass and damping tuned so a released pill settles once, without the second
  // bounce that read as a stutter at the end of every swipe.
  const pillSpring = { type: "spring" as const, stiffness: 420, damping: 32, mass: 0.6 };
  const settled = useRef(false);
  // Where the pill is currently springing to, so the route-change effect below
  // doesn't restart an animation that is already heading to the right tab.
  const settleTarget = useRef<number | null>(null);

  /** Move the pill to a tab, folding any in-progress drag into the resting
   *  offset first so the spring starts from where the finger left it. */
  function settlePillTo(index: number) {
    if (!tabWidth) return;
    const target = index * tabWidth;
    baseX.set(baseX.get() + dragX.get());
    dragX.set(0);
    settleTarget.current = target;
    void animate(baseX, target, pillSpring).then(() => {
      if (settleTarget.current === target) settleTarget.current = null;
    });
  }

  function navigateTo(index: number) {
    if (index === activeIndex) return;
    haptic("light");
    settlePillTo(index);
    router.push(NAV[index].href);
  }

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNavWidth(el.clientWidth));
    ro.observe(el);
    setNavWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Keep the pill in sync with the route (back/forward, a link elsewhere in the
  // app, a resize). This used to hard-`set()` the position, which snapped the
  // pill mid-flight and killed the spring started on release — the jump people
  // saw after dragging and letting go. Now it only animates when it is actually
  // out of place, so the release spring is left to finish on its own.
  const lastTabWidth = useRef(0);
  useEffect(() => {
    if (!tabWidth || dragging.current) return;
    indexAtStart.current = activeIndex;
    const target = activeIndex * tabWidth;
    // First measurement, or the bar changed size (rotation, keyboard, resize):
    // put the pill where it belongs instead of gliding it there.
    if (!settled.current || lastTabWidth.current !== tabWidth) {
      settled.current = true;
      lastTabWidth.current = tabWidth;
      settleTarget.current = null;
      baseX.set(target);
      dragX.set(0);
      return;
    }
    if (settleTarget.current === target) return; // already on its way there
    if (Math.abs(baseX.get() + dragX.get() - target) < 0.5) return;
    settlePillTo(activeIndex);
    // `pillSpring` and `settlePillTo` are stable for a given tabWidth; listing
    // them would restart the spring on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, tabWidth, baseX, dragX]);

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    dragging.current = true;
    setIsDragging(true);
    didDrag.current = false;
    pointerId.current = e.pointerId;
    startX.current = e.clientX;
    indexAtStart.current = activeIndex;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current || pointerId.current !== e.pointerId || !tabWidth) return;
    const dx = e.clientX - startX.current;
    if (Math.abs(dx) > 6) didDrag.current = true;
    const min = -(indexAtStart.current * tabWidth);
    const max = (NAV.length - 1 - indexAtStart.current) * tabWidth;
    dragX.set(Math.max(min, Math.min(max, dx)));
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!dragging.current || pointerId.current !== e.pointerId) return;
    dragging.current = false;
    setIsDragging(false);
    pointerId.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);

    if (!tabWidth) {
      dragX.set(0);
      return;
    }

    const dx = dragX.get();
    const moved = dx / tabWidth;
    const target = Math.round(indexAtStart.current + moved);
    const clamped = Math.max(0, Math.min(NAV.length - 1, target));

    // Either way the pill settles on a spring from where it was released; a
    // navigation just changes which tab it settles on.
    settlePillTo(clamped);
    if (clamped !== activeIndex) {
      haptic("light");
      router.push(NAV[clamped].href);
    }
  }

  function onPointerCancel() {
    dragging.current = false;
    setIsDragging(false);
    pointerId.current = null;
    settlePillTo(activeIndex);
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(env(safe-area-inset-bottom),0.6rem)] md:hidden">
      <div
        ref={navRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        className="mobile-tab-bar relative mx-auto flex max-w-md touch-pan-y items-stretch rounded-full p-1"
      >
        {navWidth > 0 && (
          <motion.span
            aria-hidden
            className="mobile-tab-pill pointer-events-none absolute inset-y-1 left-0"
            style={{ width: tabWidth, x: pillX, willChange: "transform" }}
            animate={{ scale: isDragging ? 1.015 : 1 }}
            transition={pillSpring}
          />
        )}
        {NAV.map((item, index) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              aria-current={active ? "page" : undefined}
              onClick={(e) => {
                if (didDrag.current) {
                  e.preventDefault();
                  didDrag.current = false;
                  return;
                }
                if (index !== activeIndex) {
                  e.preventDefault();
                  navigateTo(index);
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
            </Link>
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
/** A rail row that opens a panel instead of navigating. Same shape as
 *  `RailLink` so the assistant reads as one of the places you can go. */
function RailButton({
  label,
  Icon,
  collapsed,
  onClick,
}: {
  label: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={cn(
        "press-none relative flex items-center gap-2.5 overflow-hidden rounded-lg px-2.5 py-2 text-left text-[13.5px] font-medium",
        "transition-colors duration-[var(--motion-standard)]",
        "text-ink-soft hover:bg-surface-sunken hover:text-ink"
      )}
    >
      <Icon className="relative z-[1] h-4 w-4 shrink-0 text-accent" strokeWidth={1.9} />
      <span className="relative z-[1] flex min-w-0">
        <RailLabel collapsed={collapsed}>{label}</RailLabel>
      </span>
    </button>
  );
}

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
