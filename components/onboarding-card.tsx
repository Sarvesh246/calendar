"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, CalendarClock, Cloud, Link2, X } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useHasMounted } from "@/lib/use-has-mounted";
import { motion as motionTokens } from "@/lib/motion";
import { useAuth } from "@/components/auth-provider";
import { GoogleSignInButton } from "@/components/account-section";
import { useUIStore } from "@/lib/ui-store";

export function OnboardingCard() {
  const { user, configured } = useAuth();
  const itemCount = useDatebookStore((s) => s.items.length);
  const sourceCount = useDatebookStore((s) => s.importSources.length);
  const dismissed = useDatebookStore((s) => s.settings.onboardingDismissed);
  const updateSettings = useDatebookStore((s) => s.updateSettings);
  const openClassSchedule = useUIStore((s) => s.openClassSchedule);
  // The server (and the first client render) sees the store's defaults — no
  // items, no dismissal — so without this gate every load of a *populated*
  // calendar flashed "Datebook starts empty" until the persisted state landed.
  const mounted = useHasMounted();

  const show = mounted && !dismissed && itemCount === 0 && sourceCount === 0;

  return (
    // Dismissing used to unmount the card outright, so the page below jumped up
    // by its full height in one frame.
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key="onboarding"
          exit={{ opacity: 0, height: 0, marginBottom: 0, transition: { duration: motionTokens.exit, ease: motionTokens.easeIn } }}
          className="overflow-hidden rounded-xl border border-line bg-surface px-4 py-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[15px] font-semibold text-ink">Get your week in here</p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                Datebook starts empty. Import a class feed or add weekly meeting times — then turn on reminders or sign in so this device isn&apos;t the only copy.
              </p>
            </div>
            <button
              type="button"
              onClick={() => updateSettings({ onboardingDismissed: true })}
              aria-label="Dismiss"
              className="rounded-md p-1.5 text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Link
              href="/settings#import"
              className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-ink"
            >
              <Link2 className="h-3.5 w-3.5" strokeWidth={2} />
              Import a calendar
            </Link>
            <button
              type="button"
              onClick={() => openClassSchedule()}
              className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium text-ink transition-colors hover:border-line-strong hover:bg-surface-sunken"
            >
              <CalendarClock className="h-3.5 w-3.5" strokeWidth={2} />
              Add class times
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-1 pt-0.5">
            <Link
              href="/settings#reminders"
              className="flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-ink-soft hover:text-ink"
            >
              <Bell className="h-3.5 w-3.5" strokeWidth={2} />
              Enable reminders
            </Link>
            {configured && user === null && (
              <GoogleSignInButton
                idleIcon={<Cloud className="h-3.5 w-3.5" strokeWidth={2} />}
                className="flex min-h-11 items-center justify-center gap-1.5 text-[13px] font-medium text-ink-soft hover:text-ink disabled:opacity-50"
              >
                Sign in
              </GoogleSignInButton>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
