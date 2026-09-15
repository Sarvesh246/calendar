"use client";

import { useRouter } from "next/navigation";
import { useDatebookStore } from "@/lib/store";
import { navigateTab } from "@/lib/tab-nav";
import { isTabRoute, type TabRoute } from "@/lib/tab-routes";
import { readViewState } from "@/lib/view-state";
import { haptic } from "@/lib/haptic";

/** Resolve where Done should return: last main tab, then landing preference, then Today. */
export function resolveRoomExit(): TabRoute {
  const last = readViewState().lastTab;
  if (last && isTabRoute(last)) return last;
  const landing = useDatebookStore.getState().settings.landingView;
  const href = `/${landing}`;
  return isTabRoute(href) ? href : "/today";
}

/**
 * Phone-only exit chrome for Settings / Schedule — explicit Done so leaving a
 * "room" does not depend on guessing the tab bar (whose pill may still sit on
 * Today while you are elsewhere).
 */
export function MobileRoomHeader({ title }: { title: string }) {
  const router = useRouter();

  return (
    <header className="mb-1 flex items-center gap-2 md:hidden">
      <button
        type="button"
        onClick={() => {
          haptic("light");
          navigateTab(router, resolveRoomExit());
        }}
        className="press-none -ml-1.5 flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2.5 text-[15px] font-semibold text-accent"
      >
        Done
      </button>
      <h1 className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold tracking-tight text-ink">
        {title}
      </h1>
      {/* Balance the Done control so the title stays visually centered. */}
      <span className="pointer-events-none min-h-11 min-w-11 opacity-0" aria-hidden>
        Done
      </span>
    </header>
  );
}
