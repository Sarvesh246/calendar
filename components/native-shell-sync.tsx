"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDatebookStore } from "@/lib/store";
import { useFocusSessionStore } from "@/lib/focus-session-store";
import { isNativeWrapper, postToNative, useNativeMessage } from "@/lib/native-bridge";
import { buildNativeSnapshot } from "@/lib/native-snapshot";
import { setStatusWithUndo } from "@/lib/item-actions";
import { useUIStore } from "@/lib/ui-store";
import { isTabRoute } from "@/lib/tab-routes";
import { navigateTab, useResolvedPathname } from "@/lib/tab-nav";
import { useAssistantModelStore } from "@/lib/assistant-models";

/**
 * IPA only: keep the native shell's notification / widget / Live Activity /
 * Spotlight snapshot in lockstep with the store. A no-op in the browser.
 */
export function NativeShellSync() {
  const wrapped = isNativeWrapper();
  const router = useRouter();
  const pathname = useResolvedPathname();
  const items = useDatebookStore((s) => s.items);
  const categories = useDatebookStore((s) => s.categories);
  const importSources = useDatebookStore((s) => s.importSources);
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const classReminderMinutes = useDatebookStore((s) => s.settings.classReminderMinutes);
  const appleCalendarSync = useDatebookStore((s) => s.settings.appleCalendarSync);
  const liveActivityEnabled = useDatebookStore((s) => s.settings.liveActivityEnabled);
  const liveActivityPrivacy = useDatebookStore((s) => s.settings.liveActivityPrivacy);
  const focus = useFocusSessionStore((s) => s.session);
  const focusMode = useUIStore((s) => s.focusMode);
  const quickAddOpen = useUIStore((s) => s.quickAddOpen);
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen);
  const filterOpen = useUIStore((s) => s.filterOpen);
  const aiDrawerOpen = useUIStore((s) => s.aiDrawerOpen);
  const classScheduleOpen = useUIStore((s) => s.classScheduleOpen);
  const inspectorItemId = useUIStore((s) => s.inspectorItemId);
  const contextMenu = useUIStore((s) => s.contextMenu);
  const activeViewId = useUIStore((s) => s.activeViewId);
  const categoryFilter = useUIStore((s) => s.categoryFilter);
  const hideCompleted = useDatebookStore((s) => s.settings.hideCompleted);
  const assistantModels = useAssistantModelStore((s) => s.models);
  const assistantModelId = useAssistantModelStore((s) => s.selectedId);
  const loadAssistantModels = useAssistantModelStore((s) => s.load);
  const [domRevision, setDomRevision] = useState(0);
  const [timeRevision, setTimeRevision] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!wrapped) return;
    postToNative("requestNativeNotifications");
    void loadAssistantModels();
    const retry = () => {
      if (document.visibilityState === "visible") void loadAssistantModels();
    };
    document.addEventListener("visibilitychange", retry);
    window.addEventListener("focus", retry);
    return () => {
      document.removeEventListener("visibilitychange", retry);
      window.removeEventListener("focus", retry);
    };
  }, [wrapped, loadAssistantModels]);

  // Recompute date-driven native state at minute boundaries while the app is
  // alive. This catches event transitions, midnight, and time-zone changes
  // without sending second-by-second ActivityKit updates.
  useEffect(() => {
    if (!wrapped) return;
    let zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const tick = () => {
      const nextZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (nextZone !== zone) zone = nextZone;
      setTimeRevision((value) => value + 1);
    };
    const interval = window.setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [wrapped]);

  // The class is also injected before the first WebView paint by Calendar-ios.
  // Reassert it here for client navigations and watch the root because sheets,
  // custom themes, and accessibility state all change there without touching
  // React state in this component.
  useEffect(() => {
    if (!wrapped) return;
    const root = document.documentElement;
    root.classList.add("native-ios");
    const observer = new MutationObserver(() => setDomRevision((value) => value + 1));
    observer.observe(root, { attributes: true, attributeFilter: ["class", "style", "data-preset"] });
    return () => observer.disconnect();
  }, [wrapped]);

  useEffect(() => {
    if (!wrapped) return;
    const root = document.documentElement;
    const css = getComputedStyle(root);
    const modalOpen =
      root.classList.contains("scroll-locked") ||
      quickAddOpen ||
      commandPaletteOpen ||
      filterOpen ||
      aiDrawerOpen ||
      classScheduleOpen ||
      Boolean(inspectorItemId) ||
      Boolean(contextMenu);
    postToNative("nativeChromeState", {
      ready: true,
      pathname,
      focusMode,
      obscured: modalOpen,
      assistantOpen: aiDrawerOpen,
      assistantModels,
      assistantModelId,
      inRoom: pathname === "/settings" || pathname === "/schedule",
      filtersActive: Boolean(activeViewId || categoryFilter?.length || hideCompleted),
      appearance: css.colorScheme === "dark" ? "dark" : "light",
      colors: {
        surface: css.getPropertyValue("--surface-elevated").trim() || "#ffffff",
        ink: css.getPropertyValue("--ink").trim() || "#1c1c1e",
        inkSoft: css.getPropertyValue("--ink-soft").trim() || "#636366",
        inkFaint: css.getPropertyValue("--ink-faint").trim() || "#6d6d71",
        accent: css.getPropertyValue("--accent").trim() || "#007aff",
        accentInk: css.getPropertyValue("--accent-ink").trim() || "#ffffff",
      },
    });
  }, [
    wrapped,
    pathname,
    focusMode,
    quickAddOpen,
    commandPaletteOpen,
    filterOpen,
    aiDrawerOpen,
    classScheduleOpen,
    inspectorItemId,
    contextMenu,
    activeViewId,
    categoryFilter,
    hideCompleted,
    assistantModels,
    assistantModelId,
    domRevision,
  ]);

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
          liveActivityEnabled,
          liveActivityPrivacy,
          accentHex:
            getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() ||
            "#0A84FF",
          focus,
          now: new Date(),
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
    liveActivityEnabled,
    liveActivityPrivacy,
    focus,
    domRevision,
    timeRevision,
  ]);

  useNativeMessage("nativeIntent", (payload) => {
    const msg = payload as { type?: string; itemId?: string; text?: string; url?: string; modelId?: string } | null;
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
    } else if (msg.type === "navigate" && msg.url?.startsWith("/")) {
      if (isTabRoute(msg.url)) navigateTab(router, msg.url);
      else router.push(msg.url);
    } else if (msg.type === "ask") {
      useUIStore.getState().setAIDrawerOpen(true);
    } else if (msg.type === "selectAssistantModel" && msg.modelId) {
      useAssistantModelStore.getState().select(msg.modelId);
    } else if (msg.type === "search") {
      useUIStore.getState().setCommandPaletteOpen(true);
    } else if (msg.type === "filters") {
      useUIStore.getState().setFilterOpen(true);
    } else if (msg.type === "exitFocus") {
      useUIStore.getState().exitFocusRoom();
    } else if (msg.type === "pauseFocus") {
      useFocusSessionStore.getState().pause();
    } else if (msg.type === "resumeFocus") {
      useFocusSessionStore.getState().resume();
    } else if (msg.type === "endFocus") {
      useFocusSessionStore.getState().endSession();
    }
  });

  return null;
}
