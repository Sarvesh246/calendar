"use client";

import dynamic from "next/dynamic";
import {
  Activity,
  memo,
  startTransition,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { cn } from "@/lib/utils";
import { isTabRoute, TAB_ROUTES, type TabRoute } from "@/lib/tab-routes";

const loaders: Record<TabRoute, () => Promise<{ default: ComponentType }>> = {
  "/today": () => import("@/components/pages/today-page"),
  "/calendar": () => import("@/components/pages/calendar-page"),
  "/agenda": () => import("@/components/pages/agenda-page"),
};

function TabLoading() {
  return <div role="status" className="flex min-h-0 flex-1 flex-col gap-4 py-2">
    <span className="sr-only">Loading your view…</span>
    <div aria-hidden className="h-7 w-48 animate-pulse rounded-lg bg-line/60" />
    <div aria-hidden className="min-h-24 flex-1 animate-pulse rounded-xl border border-line bg-surface" />
  </div>;
}

const TodayPage = memo(dynamic(loaders["/today"], { loading: TabLoading }));
const CalendarPage = memo(dynamic(loaders["/calendar"], { loading: TabLoading }));
const AgendaPage = memo(dynamic(loaders["/agenda"], { loading: TabLoading }));

const pages: Record<TabRoute, ComponentType> = {
  "/today": TodayPage,
  "/calendar": CalendarPage,
  "/agenda": AgendaPage,
};

const ALL_MOUNTED = Object.fromEntries(TAB_ROUTES.map((href) => [href, true])) as Record<
  TabRoute,
  true
>;

function scheduleIdle(fn: () => void) {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(fn, { timeout: 800 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(fn, 200);
  return () => window.clearTimeout(id);
}

export function TabPageHost({ pathname }: { pathname: string }) {
  const [mounted, setMounted] = useState<Partial<Record<TabRoute, true>>>(() =>
    isTabRoute(pathname) ? { [pathname]: true } : {}
  );

  useEffect(() => {
    if (!isTabRoute(pathname)) return;
    startTransition(() => {
      setMounted((m) => (m[pathname] ? m : { ...m, [pathname]: true }));
    });
  }, [pathname]);

  // Preloading the modules only removed the network from the first switch; the
  // render itself still happened on the tap. Mounting all three while the main
  // thread is idle moves that cost off the interaction entirely, so every later
  // switch is a `hidden` attribute flipping and nothing else.
  useEffect(() => {
    let cancelled = false;
    const cancel = scheduleIdle(() => {
      if (cancelled) return;
      void Promise.all(TAB_ROUTES.map((href) => loaders[href]())).then(() => {
        if (cancelled) return;
        startTransition(() => setMounted(ALL_MOUNTED));
      }).catch(() => undefined);
    });
    return () => {
      cancelled = true;
      cancel();
    };
  }, []);

  const active = isTabRoute(pathname) ? pathname : null;
  useTabScrollMemory(active);

  if (!isTabRoute(pathname) && !TAB_ROUTES.some((href) => mounted[href])) return null;

  return (
    <>
      {TAB_ROUTES.map((href) => {
        if (!mounted[href] && href !== pathname) return null;
        const Page = pages[href];
        const isActive = active === href;
        return (
          <Activity key={href} mode={isActive ? "visible" : "hidden"}>
          <div
            className={cn(
              href === "/calendar" && "flex min-h-0 flex-1 flex-col overflow-hidden"
            )}
          >
            <Page />
          </div>
          </Activity>
        );
      })}
    </>
  );
}

/**
 * Each tab remembers where you left it. The pages share one document scroller,
 * so without this, coming back to a long Agenda from a short Today dropped you
 * wherever the shorter page had clamped the scroll — a jump that read as the
 * switch itself being broken.
 */
function useTabScrollMemory(active: TabRoute | null) {
  const saved = useRef<Partial<Record<TabRoute, number>>>({});
  const liveY = useRef(0);
  const previous = useRef<TabRoute | null>(active);

  useEffect(() => {
    const onScroll = () => {
      liveY.current = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const from = previous.current;
    if (from === active) return;
    // `liveY` is the last position the user actually scrolled to, captured
    // before the swap — `window.scrollY` here would already be clamped to the
    // incoming page's height.
    if (from) saved.current[from] = liveY.current;
    previous.current = active;
    if (!active) return;
    const y = saved.current[active] ?? 0;
    liveY.current = y;
    if (y !== window.scrollY) window.scrollTo(0, y);
  }, [active]);
}
