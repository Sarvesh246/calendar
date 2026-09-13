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
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { isTabRoute, TAB_ROUTES, type TabRoute } from "@/lib/tab-routes";
import { flushViewState, recallScroll, rememberScroll } from "@/lib/view-state";
import { useTabPageSwipe } from "@/lib/use-tab-page-swipe";
import { useMediaQuery } from "@/lib/use-media-query";

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

/** How long to keep trying to reach a remembered offset as the page fills in. */
const RESTORE_WINDOW_MS = 1200;
/** Tail of that window spent confirming the offset stuck rather than chasing it. */
const SETTLE_MS = 250;

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

  // Start fetching every tab chunk immediately after the first paint. Waiting
  // for an idle callback *before* starting the imports left Agenda as the only
  // tab that could still show a loader on an early tap. Rendering the inactive
  // pages remains idle work; only the network/parse warm-up starts now.
  useEffect(() => {
    let cancelled = false;
    const modulesReady = Promise.all(TAB_ROUTES.map((href) => loaders[href]()));
    const cancel = scheduleIdle(() => {
      if (cancelled) return;
      void modulesReady.then(() => {
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
  const phone = useMediaQuery("(max-width: 767px)");
  const hostRef = useRef<HTMLDivElement>(null);
  const swipe = useTabPageSwipe(hostRef, active, phone && Boolean(active));

  if (!isTabRoute(pathname) && !TAB_ROUTES.some((href) => mounted[href])) return null;

  return (
    <div
      ref={hostRef}
      className={cn(
        "relative min-w-0 touch-pan-y",
        active === "/calendar" && "flex min-h-0 flex-1 flex-col",
        swipe.dragging && "overflow-hidden touch-none"
      )}
    >
      {TAB_ROUTES.map((href) => {
        if (!mounted[href] && href !== pathname && href !== swipe.peek) return null;
        const Page = pages[href];
        const isActive = active === href;
        const isPeek = swipe.peek === href;
        return (
          <Activity key={href} mode={isActive || isPeek ? "visible" : "hidden"}>
          <motion.div
            className={cn(
              href === "/calendar" && "flex min-h-0 flex-1 flex-col overflow-hidden",
              isPeek && "pointer-events-none absolute inset-0 overflow-auto overscroll-contain"
            )}
            style={
              isActive
                ? { x: swipe.x, willChange: "transform" }
                : isPeek
                  ? { x: swipe.peekX, willChange: "transform" }
                  : undefined
            }
          >
            <Page />
          </motion.div>
          </Activity>
        );
      })}
    </div>
  );
}

/**
 * Each tab remembers where you left it. The pages share one document scroller,
 * so without this, coming back to a long Agenda from a short Today dropped you
 * wherever the shorter page had clamped the scroll — a jump that read as the
 * switch itself being broken.
 *
 * The memory now outlives this component too (see `lib/view-state.ts`), because
 * a tab switch was never the only way to lose your place: opening Settings or
 * the schedule, or iOS discarding the tab and restoring it, dropped everything
 * a `useRef` was holding. Same behaviour, one session-scoped mirror behind it.
 */
function useTabScrollMemory(active: TabRoute | null) {
  const liveY = useRef(0);
  const previous = useRef<TabRoute | null>(active);

  useEffect(() => {
    const onScroll = () => {
      liveY.current = window.scrollY;
      if (previous.current) rememberScroll(previous.current, window.scrollY);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    // A phone is far more likely to be backgrounded than closed, and the
    // trailing write timer never runs once it is.
    const onHide = () => {
      if (previous.current) rememberScroll(previous.current, window.scrollY);
      flushViewState();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  // Banking the outgoing tab's offset is its own effect, kept apart from the
  // restore below. `liveY` is the last position the user actually scrolled to,
  // captured before the swap — `window.scrollY` here is already clamped to the
  // incoming page's height.
  useLayoutEffect(() => {
    const from = previous.current;
    if (from && from !== active) rememberScroll(from, liveY.current);
    previous.current = active;
  }, [active]);

  /**
   * Put the incoming tab back where it was.
   *
   * Deliberately free of "have I already done this" guards. Restoring to the
   * same offset twice is a no-op, whereas a ref-based guard makes the effect
   * non-idempotent — and React's development double-invoke then tears down the
   * first run's retries and returns early from the second, which is exactly how
   * this silently did nothing after a reload.
   *
   * The retries are the substance of it. Agenda paints a fortnight and expands
   * to four months when the main thread goes idle, so at the moment this first
   * runs the document is often a few hundred pixels tall and `scrollTo` clamps
   * a 1400px offset straight to 0. So: re-apply while the page grows, give up
   * once it stops growing or the deadline passes, and abandon the whole thing
   * the instant the reader scrolls for themselves — their scroll always wins.
   */
  useLayoutEffect(() => {
    if (!active) return;
    const y = recallScroll(active);
    liveY.current = y;
    if (y <= 0) return;

    const target = active;
    let done = false;
    const stop = () => {
      done = true;
    };
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", stop, { passive: true });

    const deadline = Date.now() + RESTORE_WINDOW_MS;
    let frame = 0;
    const apply = () => {
      if (done || previous.current !== target) return;
      const reachable =
        document.documentElement.scrollHeight - window.innerHeight >= y - 1;
      if (reachable) {
        if (Math.abs(window.scrollY - y) > 1) {
          window.scrollTo(0, y);
          liveY.current = y;
        }
        // Landed. One more pass guards against late layout (a font swapping,
        // an image resolving) nudging it back.
        if (Math.abs(window.scrollY - y) <= 1 && Date.now() > deadline - SETTLE_MS) return;
      }
      if (Date.now() > deadline) return;
      frame = requestAnimationFrame(apply);
    };
    apply();

    return () => {
      done = true;
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
    };
  }, [active]);
}
