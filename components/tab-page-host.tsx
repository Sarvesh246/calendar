"use client";

import dynamic from "next/dynamic";
import { startTransition, useEffect, useState, type ComponentType } from "react";
import { cn } from "@/lib/utils";
import { isTabRoute, TAB_ROUTES, type TabRoute } from "@/lib/tab-routes";

const loaders: Record<TabRoute, () => Promise<{ default: ComponentType }>> = {
  "/today": () => import("@/components/pages/today-page"),
  "/calendar": () => import("@/components/pages/calendar-page"),
  "/agenda": () => import("@/components/pages/agenda-page"),
};

const TodayPage = dynamic(loaders["/today"]);
const CalendarPage = dynamic(loaders["/calendar"]);
const AgendaPage = dynamic(loaders["/agenda"]);

const pages: Record<TabRoute, ComponentType> = {
  "/today": TodayPage,
  "/calendar": CalendarPage,
  "/agenda": AgendaPage,
};

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

  useEffect(() => {
    return scheduleIdle(() => {
      for (const href of TAB_ROUTES) void loaders[href]();
    });
  }, []);

  if (!isTabRoute(pathname) && !TAB_ROUTES.some((href) => mounted[href])) return null;

  const active = isTabRoute(pathname) ? pathname : null;

  return (
    <>
      {TAB_ROUTES.map((href) => {
        if (!mounted[href] && href !== pathname) return null;
        const Page = pages[href];
        const isActive = active === href;
        return (
          <div
            key={href}
            hidden={!isActive}
            {...(!isActive ? { inert: true } : {})}
            aria-hidden={!isActive}
            className={cn(
              href === "/calendar" && "flex min-h-0 flex-1 flex-col md:overflow-hidden"
            )}
          >
            <Page />
          </div>
        );
      })}
    </>
  );
}
