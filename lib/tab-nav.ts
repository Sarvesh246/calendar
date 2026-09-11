"use client";

import { startTransition, useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { isTabRoute } from "./tab-routes";

/**
 * The three tab routes render nothing on the server — `app/today/page.tsx` and
 * friends return `null`, and the real pages live client-side in `TabPageHost`.
 * So the only thing a tab switch actually needs is a new value for `pathname`…
 * which the App Router only hands over once its own navigation has committed.
 * That commit is what you felt as lag: the pill moved under your thumb and the
 * page underneath waited a beat for the router to catch up, and spamming tabs
 * queued those beats up behind each other.
 *
 * So the tab we *render* is decoupled from the router: a tap sets it here,
 * synchronously, and `router.push` runs afterwards purely to keep the URL and
 * history honest. Once the router has worked through every tap it was given,
 * the override drops away and `usePathname` takes over again.
 */
let pending: string | null = null;
/** Where the router was when the first un-committed tap happened. */
let pendingFrom: string | null = null;
/** Taps handed to the router and not yet seen coming back, oldest first. */
let inFlight: string[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return pending;
}

/** The server has no pending navigation — and never a mismatched snapshot. */
function getServerSnapshot(): string | null {
  return null;
}

function clearPending() {
  inFlight = [];
  pendingFrom = null;
  if (pending === null) return;
  pending = null;
  emit();
}

/**
 * Reconcile a freshly committed router path with the taps still outstanding.
 * Landing on an earlier tap while a later one is still travelling must not
 * yank the view backwards — that flicker is exactly what spamming the bar
 * would otherwise look like.
 */
function settle(actual: string) {
  if (pending === null) return;
  const index = inFlight.indexOf(actual);
  if (index >= 0) {
    inFlight = inFlight.slice(index + 1);
    if (inFlight.length === 0) clearPending();
    return;
  }
  // Not one of ours: the router went somewhere else (a link, a redirect, the
  // back button). It knows better than a tap we are still waiting on.
  if (actual !== pendingFrom) clearPending();
}

/** The path the UI should draw right now — the tapped tab, or the router's. */
export function useResolvedPathname(): string {
  const actual = usePathname();
  const optimistic = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    settle(actual);
  }, [actual, optimistic]);

  // Back/forward moves the router on its own; whatever was tapped before is no
  // longer what the user asked for, so stop overriding.
  useEffect(() => {
    window.addEventListener("popstate", clearPending);
    return () => window.removeEventListener("popstate", clearPending);
  }, []);

  return optimistic ?? actual;
}

/**
 * Switch tabs. The view swaps on this frame; the router follows in a
 * transition, where a slow commit can no longer hold the paint hostage.
 */
export function navigateTab(router: { push: (href: string) => void }, href: string) {
  if (isTabRoute(href)) {
    if (pending === null) pendingFrom = window.location.pathname;
    inFlight.push(href);
    if (pending !== href) {
      pending = href;
      emit();
    }
  }
  startTransition(() => {
    router.push(href);
  });
}
