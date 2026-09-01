"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const MAIN_ROUTES = ["/today", "/calendar", "/agenda", "/settings"];

// A template (unlike a layout) re-mounts on every navigation. Wrapping the page
// in `.page-shell` here means its sections replay the staggered `content-rise`
// reveal (see globals.css) each time the route changes — no JS, so it can never
// leave a page stuck mid-animation.
const TAB_ROUTES = ["/today", "/calendar", "/agenda"];

export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fillViewport = pathname === "/calendar";
  const isTabRoute = TAB_ROUTES.includes(pathname);
  const routeIndex = MAIN_ROUTES.indexOf(pathname);
  const slideClass =
    routeIndex >= 0 ? (`route-from-${routeIndex}` as const) : "route-from-0";

  return (
    <div
      className={cn(
        "page-shell",
        isTabRoute ? "route-enter-instant" : "route-enter",
        slideClass,
        fillViewport && "flex min-h-0 flex-1 flex-col md:overflow-hidden"
      )}
    >
      {children}
    </div>
  );
}
