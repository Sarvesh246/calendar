"use client";

import { useState } from "react";
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

export function NotificationToggle() {
  const mounted = useHasMounted();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [busy, setBusy] = useState(false);

  // Read the live value only after mount — Notification isn't defined during SSR.
  const current = mounted ? notificationPermission() : "default";
  const state = permission === "default" ? current : permission;

  async function enable() {
    setBusy(true);
    const result = await requestNotificationPermission();
    setPermission(result);
    if (result === "granted") {
      await ensureReminderWorker();
      armReminders(useDatebookStore.getState().items, useDatebookStore.getState().settings.clock24h);
      void subscribePush();
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
    return (
      <p className="flex items-center gap-2 rounded-lg border border-good/40 bg-good-soft px-3.5 py-2.5 text-[13px] font-medium text-ink">
        <Check className="h-4 w-4 shrink-0 text-good" strokeWidth={2.5} />
        Notifications on — reminders fire while Datebook is open and catch up when you return.
        {vapidPublicKey()
          ? " Closed-app alerts are on for this signed-in browser."
          : " Closed-app push needs VAPID keys on the server — until then, keep a tab open or reopen to catch up."}
      </p>
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
