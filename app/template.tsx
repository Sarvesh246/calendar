"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isTabRoute } from "@/lib/tab-routes";

// A template (unlike a layout) re-mounts on every navigation. Wrapping the page
// in `.page-shell` here means its sections replay the staggered `content-rise`
// reveal (see globals.css) each time the route changes — no JS, so it can never
// leave a page stuck mid-animation.
//
// Tab routes are kept alive in AppShell's TabPageHost, so this wrapper only
// applies to real remounts (Settings, legal pages). The tab pill carries that
// motion — a second fade here is what read as a flash against a big commit.
export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fillViewport = pathname === "/calendar";
  const tab = isTabRoute(pathname);

  if (tab) {
    return (
      <div className={cn(fillViewport && "flex min-h-0 flex-1 flex-col md:overflow-hidden")}>
        {children}
      </div>
    );
  }

  return (
    <div
      key={pathname}
      className={cn(
        "page-shell route-enter",
        fillViewport && "flex min-h-0 flex-1 flex-col md:overflow-hidden"
      )}
    >
      {children}
    </div>
  );
}
