"use client";

/**
 * Fetch every on-demand panel while the page is idle, one per idle slice, so
 * opening one later never waits on the network or paints a placeholder.
 * Registered by each lazy component's owner; run once by AppShell.
 */
const warmers: Array<() => Promise<unknown>> = [];
let started = false;

export function registerWarmUp(preload: () => Promise<unknown>) {
  warmers.push(preload);
  if (started) queue(preload);
}

function idle(fn: () => void) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(fn, { timeout: 2500 });
  } else {
    setTimeout(fn, 300);
  }
}

function queue(preload: () => Promise<unknown>) {
  idle(() => {
    void preload().catch(() => undefined);
  });
}

export function warmUp() {
  if (started || typeof window === "undefined") return;
  started = true;
  // Chained rather than all at once: each fetch/parse gets its own idle slice
  // instead of one long task landing on whatever the user does next.
  let i = 0;
  const next = () => {
    const preload = warmers[i++];
    if (!preload) return;
    idle(() => {
      void preload()
        .catch(() => undefined)
        .finally(next);
    });
  };
  next();
}
