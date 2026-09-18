"use client";

import { useEffect, useRef } from "react";
import { useDatebookStore } from "@/lib/store";
import { useFocusSessionStore } from "@/lib/focus-session-store";
import { isNativeWrapper, postToNative, useNativeMessage } from "@/lib/native-bridge";
import { buildNativeSnapshot } from "@/lib/native-snapshot";
import { setStatusWithUndo } from "@/lib/item-actions";
import { useUIStore } from "@/lib/ui-store";

/**
 * IPA only: keep the native shell's notification / widget / Live Activity /
 * Spotlight snapshot in lockstep with the store. A no-op in the browser.
 */
export function NativeShellSync() {
  const wrapped = isNativeWrapper();
  const items = useDatebookStore((s) => s.items);
  const categories = useDatebookStore((s) => s.categories);
  const importSources = useDatebookStore((s) => s.importSources);
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const classReminderMinutes = useDatebookStore((s) => s.settings.classReminderMinutes);
  const appleCalendarSync = useDatebookStore((s) => s.settings.appleCalendarSync);
  const focus = useFocusSessionStore((s) => s.session);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!wrapped) return;
    postToNative("requestNativeNotifications");
  }, [wrapped]);

  useEffect(() => {
    if (!wrapped) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      postToNative(
        "nativeSnapshot",
        buildNativeSnapshot({
          items,
          categories,
          importSources,
          clock24h,
          classReminderMinutes,
          appleCalendarSync,
          focus,
        })
      );
    }, 280);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [
    wrapped,
    items,
    categories,
    importSources,
    clock24h,
    classReminderMinutes,
    appleCalendarSync,
    focus,
  ]);

  useNativeMessage("nativeIntent", (payload) => {
    const msg = payload as { type?: string; itemId?: string; text?: string; url?: string } | null;
    if (!msg?.type) return;
    const store = useDatebookStore.getState();
    if (msg.type === "complete" && msg.itemId) {
      const item = store.items.find((i) => i.id === msg.itemId);
      if (item) setStatusWithUndo(item, "done");
    } else if (msg.type === "snooze" && msg.itemId) {
      store.snoozeItem(msg.itemId, 15);
    } else if (msg.type === "focus") {
      if (msg.itemId) useFocusSessionStore.getState().ensureSession(msg.itemId);
      useUIStore.getState().enterFocus();
    } else if (msg.type === "compose") {
      useUIStore.getState().setQuickAddPrefill(msg.text ?? "");
      useUIStore.getState().setQuickAddOpen(true);
    }
  });

  return null;
}
