"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// A template (unlike a layout) re-mounts on every navigation. Wrapping the page
// in `.page-shell` here means its sections replay the staggered `content-rise`
// reveal (see globals.css) each time the route changes — no JS, so it can never
// leave a page stuck mid-animation.
export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fillViewport = pathname === "/calendar";
  return (
    <div
      className={cn(
        "page-shell",
        fillViewport && "flex min-h-0 flex-1 flex-col overflow-hidden"
      )}
    >
      {children}
    </div>
  );
}
