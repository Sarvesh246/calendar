/**
 * Three different nothings.
 *
 * "Nothing scheduled", "you finished everything" and "your filters hid it all"
 * are three completely different facts about a day, and the app used to render
 * the same grey box for all of them. The one that matters most is the third:
 * an empty screen caused by a filter is indistinguishable from a broken app
 * unless it says so, and says how to undo it.
 *
 * Pure so the wording is testable and identical everywhere it appears.
 */

export type EmptyKind = "nothing" | "done" | "filtered";
export type EmptyAction = "clear-filters" | "show-completed" | "add" | null;

export interface EmptyStateCopy {
  kind: EmptyKind;
  title: string;
  sub: string;
  /** Which affordance the caller should render, if any. */
  action: EmptyAction;
}

export interface EmptyStateInput {
  /** Where this list lives, as a noun phrase: "today", "this day", "ahead". */
  scope: string;
  /** How many items the scope holds with every filter switched off. */
  total: number;
  /** Of those, how many the class filter is hiding. */
  hiddenByCategory: number;
  /** Of those, how many "hide completed" is hiding. */
  hiddenByCompletion: number;
  /** Of those, how many the active saved view's rules are hiding. */
  hiddenByView?: number;
  /** Offer an add affordance when the scope is a single day you can add to. */
  canAdd?: boolean;
}

export function describeEmptyState(input: EmptyStateInput): EmptyStateCopy {
  const {
    scope,
    total,
    hiddenByCategory,
    hiddenByCompletion,
    hiddenByView = 0,
    canAdd = false,
  } = input;

  if (total === 0) {
    return {
      kind: "nothing",
      title: "Nothing scheduled.",
      sub: canAdd
        ? `Nothing on ${scope} yet — add something whenever you're ready.`
        : `Nothing on ${scope} yet.`,
      action: canAdd ? "add" : null,
    };
  }

  // Everything in scope is finished, and completion is the *only* reason the
  // list is empty. That's an accomplishment, not a filter problem — say so even
  // though "hide completed" is technically what emptied the view.
  if (hiddenByCategory === 0 && hiddenByView === 0 && hiddenByCompletion === total) {
    return {
      kind: "done",
      title: total === 1 ? "All done." : "Everything completed.",
      sub:
        total === 1
          ? `The one thing on ${scope} is finished.`
          : `All ${total} things on ${scope} are finished.`,
      action: "show-completed",
    };
  }

  const bits: string[] = [];
  if (hiddenByCategory > 0) {
    bits.push(`${hiddenByCategory} hidden by the class filter`);
  }
  if (hiddenByCompletion > 0) {
    bits.push(`${hiddenByCompletion} already completed`);
  }
  if (hiddenByView > 0) {
    bits.push(`${hiddenByView} outside your saved view`);
  }

  return {
    kind: "filtered",
    title: "Nothing matches your filters.",
    sub:
      bits.length > 0
        ? `${total} thing${total === 1 ? "" : "s"} on ${scope} — ${bits.join(", ")}.`
        : `${total} thing${total === 1 ? "" : "s"} on ${scope} are filtered out.`,
    action: "clear-filters",
  };
}
