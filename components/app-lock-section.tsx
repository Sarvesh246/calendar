"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { motion } from "framer-motion";
import { isNativeWrapper, postToNative, useNativeMessage } from "@/lib/native-bridge";
import { ToggleSwitch } from "@/components/toggle-switch";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";

type AppLockState = { enabled: boolean; requireAfterMinutes: number };

const TIMING_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Immediately" },
  { value: 1, label: "After 1 min" },
  { value: 5, label: "After 5 min" },
  { value: 15, label: "After 15 min" },
  { value: -1, label: "Only when closed" },
];

/**
 * Remote control for the Face ID lock Calendar-ios enforces natively (it has
 * to gate content before any web JS runs, so native holds the real state —
 * this just reflects and edits it over the bridge). Renders nothing outside
 * the wrapper; Face ID has no meaning in a browser tab.
 */
function subscribeNever() {
  return () => {};
}

export function AppLockSection() {
  // navigator.userAgent never changes mid-session, so this never needs to
  // re-fire — a static external read, not something that belongs in an
  // effect (avoids a server/client hydration mismatch: SSR has no navigator).
  const wrapped = useSyncExternalStore(subscribeNever, isNativeWrapper, () => false);
  const [state, setState] = useState<AppLockState | null>(null);

  useEffect(() => {
    if (wrapped) postToNative("getAppLock");
  }, [wrapped]);

  useNativeMessage("appLockState", (payload) => {
    setState(payload as AppLockState);
  });

  if (!wrapped) return null;

  function update(next: AppLockState) {
    setState(next);
    postToNative("setAppLock", next);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-sunken/30 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[14px] text-ink">Face ID lock</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-faint">Require Face ID to open Datebook.</p>
        </div>
        <ToggleSwitch
          checked={state?.enabled ?? false}
          onChange={(enabled) => {
            haptic("light");
            update({ enabled, requireAfterMinutes: state?.requireAfterMinutes ?? 5 });
          }}
          label="Face ID lock"
        />
      </div>

      {state?.enabled && (
        <div
          role="radiogroup"
          aria-label="Re-lock timing"
          className="grid grid-cols-2 gap-1 rounded-xl border border-line/80 bg-surface-sunken/40 p-1 sm:grid-cols-5"
        >
          {TIMING_OPTIONS.map((opt) => {
            const active = opt.value === state.requireAfterMinutes;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  haptic("light");
                  update({ enabled: true, requireAfterMinutes: opt.value });
                }}
                className={cn(
                  "press-none relative min-h-10 rounded-lg px-2 text-[12.5px] font-medium transition-colors",
                  active ? "text-accent-ink" : "text-ink-soft hover:text-ink"
                )}
              >
                {active && (
                  <motion.span
                    layoutId="settings-applock-timing"
                    className="absolute inset-0 rounded-lg bg-accent"
                    transition={motionTokens.spring}
                  />
                )}
                <span className="relative z-[1] whitespace-nowrap">{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
