"use client";

import { useEffect } from "react";
import { useUIStore } from "@/lib/ui-store";

type Expander = () => void;

const expanders = new Map<string, Expander>();
let pendingId: string | null = null;

/** Cards register here instead of each subscribing to `focusedItemId`. */
export function registerItemExpander(id: string, expand: Expander) {
  expanders.set(id, expand);
  if (pendingId === id) {
    pendingId = null;
    expand();
  }
  return () => {
    if (expanders.get(id) === expand) expanders.delete(id);
  };
}

export function requestItemExpand(id: string) {
  pendingId = id;
  const expand = expanders.get(id);
  if (!expand) return false;
  pendingId = null;
  expand();
  return true;
}

export function clearPendingItemExpand() {
  pendingId = null;
}

/** Single store subscription that fans out to the matching mounted card. */
export function FocusedItemRelay() {
  const id = useUIStore((s) => s.focusedItemId);
  useEffect(() => {
    if (id) requestItemExpand(id);
    else clearPendingItemExpand();
  }, [id]);
  return null;
}
