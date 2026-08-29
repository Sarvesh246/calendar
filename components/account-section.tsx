"use client";

import { useState } from "react";
import { Cloud, CloudOff, Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "./auth-provider";
import { useDatebookStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export function AccountSection() {
  const { user, configured, signingIn, signInWithGoogle, signOut } = useAuth();
  const syncStatus = useDatebookStore((s) => s.syncStatus);
  const cloudError = useDatebookStore((s) => s.cloudError);
  const retrySync = useDatebookStore((s) => s.retrySync);

  const [error, setError] = useState<string | null>(null);

  if (!configured) {
    return (
      <p className="text-[13px] leading-relaxed text-ink-soft">
        Cloud sync isn&apos;t set up yet. Add your Supabase project&apos;s{" "}
        <code className="rounded bg-surface-sunken px-1 py-0.5 text-[12px]">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code className="rounded bg-surface-sunken px-1 py-0.5 text-[12px]">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>{" "}
        to <code className="rounded bg-surface-sunken px-1 py-0.5 text-[12px]">.env.local</code> and run the SQL in{" "}
        <code className="rounded bg-surface-sunken px-1 py-0.5 text-[12px]">supabase/migrations</code>. Until then your
        data stays on this device.
      </p>
    );
  }

  if (user === undefined) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-ink-soft">
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> Checking your session…
      </p>
    );
  }

  if (user) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-medium text-ink">{user.email}</p>
            <SyncLine status={syncStatus} error={cloudError} />
          </div>
          <button
            onClick={() => signOut()}
            className="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
          >
            Sign out
          </button>
        </div>
        {syncStatus === "error" ? (
          <div className="flex flex-col gap-2 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2.5">
            <p className="text-[12.5px] leading-relaxed text-warn">
              {cloudError ?? "Something went wrong syncing."}
            </p>
            <button
              onClick={() => retrySync()}
              className="self-start rounded-md border border-line px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
            >
              Retry sync
            </button>
          </div>
        ) : (
          <p className="text-[12.5px] leading-relaxed text-ink-faint">
            Your calendar is saved to your account and syncs live across every signed-in device — changes appear
            without a refresh.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] leading-relaxed text-ink-soft">
        Sign in to save your calendar to the cloud and sync it across devices. Data already on this device is imported
        on first sign-in.
      </p>
      <button
        onClick={async () => {
          setError(null);
          try {
            await signInWithGoogle();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't start sign-in.");
          }
        }}
        disabled={signingIn}
        className="flex items-center justify-center gap-2.5 rounded-lg border border-line bg-surface px-4 py-2.5 text-[13.5px] font-medium text-ink transition-colors hover:border-line-strong disabled:opacity-50"
      >
        {signingIn ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
        ) : (
          <GoogleGlyph />
        )}
        Continue with Google
      </button>
      {error && <p className="text-[12.5px] text-warn">{error}</p>}
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className="shrink-0">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function SyncLine({ status, error }: { status: string; error: string | null }) {
  const map: Record<string, { icon: React.ReactNode; label: string; cls: string }> = {
    connecting: { icon: <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />, label: "Connecting…", cls: "text-ink-faint" },
    syncing: { icon: <RefreshCw className="h-3 w-3 animate-spin" strokeWidth={2} />, label: "Syncing…", cls: "text-ink-faint" },
    synced: { icon: <Cloud className="h-3 w-3" strokeWidth={2} />, label: "Synced", cls: "text-good" },
    error: { icon: <CloudOff className="h-3 w-3" strokeWidth={2} />, label: error ?? "Sync error", cls: "text-warn" },
    merge: { icon: <Cloud className="h-3 w-3" strokeWidth={2} />, label: "Choose how to merge…", cls: "text-ink" },
    idle: { icon: <Cloud className="h-3 w-3" strokeWidth={2} />, label: "Ready", cls: "text-ink-faint" },
  };
  const s = map[status] ?? map.idle;
  return (
    <span className={cn("mt-0.5 flex items-center gap-1 truncate text-[11.5px]", s.cls)}>
      {s.icon}
      {s.label}
    </span>
  );
}
