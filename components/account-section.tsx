"use client";

import { useState } from "react";
import { Check, Cloud, CloudOff, Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "./auth-provider";
import { useDatebookStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export function AccountSection() {
  const { user, configured, sending, signInWithEmail, signOut } = useAuth();
  const syncStatus = useDatebookStore((s) => s.syncStatus);
  const cloudError = useDatebookStore((s) => s.cloudError);

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!configured) {
    return (
      <p className="text-[13px] leading-relaxed text-ink-soft">
        Cloud sync isn&apos;t set up yet. Add your Supabase project&apos;s{" "}
        <code className="rounded bg-surface-sunken px-1 py-0.5 text-[12px]">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code className="rounded bg-surface-sunken px-1 py-0.5 text-[12px]">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{" "}
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
        <p className="text-[12.5px] leading-relaxed text-ink-faint">
          Your calendar is saved to your account and syncs live across every signed-in device — changes appear
          without a refresh.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {sent ? (
        <p className="flex items-start gap-1.5 text-[13px] text-good">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
          Check <span className="font-medium">{email}</span> for a sign-in link. Open it on any device to sync there.
        </p>
      ) : (
        <>
          <p className="text-[13px] leading-relaxed text-ink-soft">
            Sign in with your email to save your calendar to the cloud and sync it across devices. Data already on this
            device is imported on first sign-in.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              try {
                await signInWithEmail(email);
                setSent(true);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Couldn't send the link.");
              }
            }}
            className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2"
          >
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoCapitalize="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink placeholder:text-ink-faint focus:outline-none"
            />
            <button
              type="submit"
              disabled={sending || !email.trim()}
              className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-30"
            >
              {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
              {sending ? "Sending" : "Send link"}
            </button>
          </form>
          {error && <p className="text-[12.5px] text-warn">{error}</p>}
        </>
      )}
    </div>
  );
}

function SyncLine({ status, error }: { status: string; error: string | null }) {
  const map: Record<string, { icon: React.ReactNode; label: string; cls: string }> = {
    connecting: { icon: <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />, label: "Connecting…", cls: "text-ink-faint" },
    syncing: { icon: <RefreshCw className="h-3 w-3 animate-spin" strokeWidth={2} />, label: "Syncing…", cls: "text-ink-faint" },
    synced: { icon: <Cloud className="h-3 w-3" strokeWidth={2} />, label: "Synced", cls: "text-good" },
    error: { icon: <CloudOff className="h-3 w-3" strokeWidth={2} />, label: error ?? "Sync error", cls: "text-warn" },
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
