"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// A template (unlike a layout) re-mounts on every navigation. Wrapping the page
// in `.page-shell` here means its sections replay the staggered `content-rise`
// reveal (see globals.css) each time the route changes — no JS, so it can never
// leave a page stuck mid-animation.
//
// The three tab routes opt out of the stagger (`route-enter-instant`): the tab
// pill carries that transition, and a second reveal running against it is what
// made tab switching feel choppy.
const TAB_ROUTES = ["/today", "/calendar", "/agenda"];

export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fillViewport = pathname === "/calendar";
  const isTabRoute = TAB_ROUTES.includes(pathname);

  return (
    <div
      key={pathname}
      className={cn(
        "page-shell",
        isTabRoute ? "route-enter-instant" : "route-enter",
        fillViewport && "flex min-h-0 flex-1 flex-col md:overflow-hidden"
      )}
    >
      {children}
    </div>
  );
}
