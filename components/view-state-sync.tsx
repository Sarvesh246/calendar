"use client";

import { useEffect } from "react";
import { useUIStore } from "@/lib/ui-store";
import { isTabRoute } from "@/lib/tab-routes";
import { useResolvedPathname } from "@/lib/tab-nav";
import { flushViewState, patchViewState, readViewState } from "@/lib/view-state";

/**
 * Keeps the class filter alive across a reload or a trip through Settings, and
 * remembers the last main tab so Settings/Schedule Done can return there.
 *
 * Filters lived in a plain Zustand store, so they survived tab switches (the
 * pages stay mounted) and nothing else. Coming back from Settings with a filter
 * silently reset is confusing in one direction; coming back with a filter
 * silently *still on* is confusing in the other — which is why this ships
 * alongside the always-visible filter bar rather than on its own.
 *
 * Session-scoped: a filter is a thing you are doing right now, not a preference.
 * Opening the app tomorrow starts on everything.
 *
 * Hydration happens in an effect, never during render — the server has no
 * `sessionStorage` and a filter applied mid-render would mismatch the markup
 * React streamed.
 */
export function ViewStateSync() {
  const pathname = useResolvedPathname();

  useEffect(() => {
    if (isTabRoute(pathname)) {
      patchViewState({ lastTab: pathname });
    }
  }, [pathname]);

  useEffect(() => {
    const remembered = readViewState().categoryFilter;
    if (remembered && remembered.length > 0) {
      useUIStore.setState({ categoryFilter: remembered });
    }

    let last = useUIStore.getState().categoryFilter;
    const unsubscribe = useUIStore.subscribe((state) => {
      if (state.categoryFilter === last) return;
      last = state.categoryFilter;
      patchViewState({ categoryFilter: last });
    });

    const onHide = () => flushViewState();
    window.addEventListener("pagehide", onHide);
    return () => {
      unsubscribe();
      window.removeEventListener("pagehide", onHide);
    };
  }, []);

  return null;
}
