"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Check } from "lucide-react";
import { useHasMounted } from "@/lib/use-has-mounted";
import { useDatebookStore } from "@/lib/store";
import {
  armReminders,
  ensureReminderWorker,
  notificationPermission,
  requestNotificationPermission,
} from "@/lib/reminders";
import { subscribePush, vapidPublicKey } from "@/lib/push-client";

function isStandaloneWindow(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches
  );
}

function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function NotificationToggle() {
  const mounted = useHasMounted();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [busy, setBusy] = useState(false);
  const [swReady, setSwReady] = useState<boolean | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushReady, setPushReady] = useState<boolean | null>(null);

  const current = mounted ? notificationPermission() : "default";
  const state = permission === "default" ? current : permission;
  const hasVapid = Boolean(vapidPublicKey());

  useEffect(() => {
    if (!mounted || notificationPermission() !== "granted" || !hasVapid) return;
    let cancelled = false;
    void subscribePush().then((result) => {
      if (cancelled) return;
      setPushReady(result.ok);
      if (!result.ok) setPushError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [mounted, hasVapid]);

  async function enable() {
    setBusy(true);
    setPushError(null);
    const result = await requestNotificationPermission();
    setPermission(result);
    if (result === "granted") {
      const registered = await ensureReminderWorker();
      setSwReady(registered);
      armReminders(useDatebookStore.getState().items, useDatebookStore.getState().settings.clock24h);
      if (hasVapid) {
        const push = await subscribePush();
        setPushReady(push.ok);
        if (!push.ok) setPushError(push.error);
      } else {
        setPushReady(false);
      }
    }
    setBusy(false);
  }

  if (!mounted) {
    return (
      <div
        className="h-[44px] animate-pulse rounded-lg border border-line bg-surface-sunken"
        aria-hidden
      />
    );
  }

  if (state === "unsupported") {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[13px] text-ink-soft">
        <BellOff className="h-4 w-4 shrink-0 text-ink-faint" strokeWidth={1.9} />
        This browser can&apos;t show notifications.
      </p>
    );
  }

  if (state === "granted") {
    const closedAppOn = hasVapid && pushReady === true;
    const iosNeedsHomeScreen = isIosDevice() && !isStandaloneWindow();
    return (
      <div className="flex flex-col gap-2">
        <p className="flex items-start gap-2 rounded-lg border border-good/40 bg-good-soft px-3.5 py-2.5 text-[13px] font-medium text-ink">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-good" strokeWidth={2.5} />
          <span>
            {closedAppOn
              ? "Notifications on. Reminders fire while Datebook is open, and as push alerts on this signed-in browser when it’s closed."
              : hasVapid
                ? "Notifications on. Reminders fire while Datebook is open and catch up when you return."
                : "Notifications on. Reminders fire while Datebook is open and catch up when you return. Closed-app alerts need push keys on the server."}
            {iosNeedsHomeScreen && closedAppOn
              ? " On iPhone, add Datebook to the Home Screen so those closed-app alerts can arrive."
              : iosNeedsHomeScreen && hasVapid
                ? " On iPhone, add Datebook to the Home Screen, then sign in, so closed-app alerts can arrive."
                : null}
          </span>
        </p>
        {swReady === false && (
          <p className="text-[12px] text-ink-soft">
            Notifications warming up. Reopen Datebook if the first alert doesn&apos;t appear.
          </p>
        )}
        {pushError && (
          <p className="rounded-lg border border-warn/40 bg-warn-soft px-3.5 py-2 text-[12px] text-ink-soft">
            {pushError}
          </p>
        )}
      </div>
    );
  }

  if (state === "denied") {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[13px] text-ink-soft">
        <BellOff className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" strokeWidth={1.9} />
        Notifications are blocked. Turn them back on for this site in your browser settings, then reload.
      </p>
    );
  }

  return (
    <button
      onClick={enable}
      disabled={busy}
      className="flex items-center justify-center gap-2 rounded-lg bg-accent px-3.5 py-2.5 text-[13px] font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      <Bell className="h-4 w-4 shrink-0" strokeWidth={2} />
      {busy ? "Waiting for permission…" : "Enable reminder notifications"}
    </button>
  );
}
