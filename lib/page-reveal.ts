/**
 * A tab page coming back into view.
 *
 * Hidden tab pages live in a hidden `<Activity>`, which disconnects their
 * effects — store subscriptions included. Tick something off on Today and the
 * Agenda behind it never hears about it: when you switch over, it is revealed
 * as it was, and only then resubscribes and catches up. Two things went wrong
 * on the way. The first paint showed the stale list (a finished item still
 * "Overdue"), and the catch-up then *animated* that stale card out, as if it
 * had just been removed in front of you.
 *
 * `TabPageHost` fixes the first by re-rendering a page with fresh data in the
 * same commit that reveals it. This module is for the second: while that
 * commit lands, changes that happened off-screen are applied as they are —
 * no exit animation, no completion linger. You didn't see them happen, so
 * there is nothing to watch finish.
 *
 * The flag is raised during the host's render and lowered in its passive
 * effect, which runs after every layout effect of the revealed page — the
 * phase where Framer starts exits and `useCompletionLinger` decides what to
 * hold.
 */
let revealing = false;

/** The store state a page rendered with; one entry per store it reads. */
export type PageRevision = { data: unknown; ui: unknown };

/**
 * What to hand a page being revealed: the current state if anything moved
 * while it was away, otherwise the very same object — so `memo` bails out and
 * a tab switch with nothing new costs no page render at all.
 */
export function revisionOnReveal(previous: PageRevision, current: PageRevision): PageRevision {
  return previous.data === current.data && previous.ui === current.ui ? previous : current;
}

export function beginPageReveal() {
  revealing = true;
}

export function endPageReveal() {
  revealing = false;
}

export function isPageRevealing() {
  return revealing;
}
