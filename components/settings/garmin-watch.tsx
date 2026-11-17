"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase/client";
import { Subheading } from "./primitives";

export function GarminWatchSection() {
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  if (!user || !supabase) return null;

  async function generate() {
    if (!supabase || !user) return;
    setBusy(true);
    try {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const next = "dbw_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(next));
      const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(
        "",
      );
      const { error } = await supabase
        .from("watch_devices")
        .insert({ user_id: user.id, token_hash: hash, name: "Forerunner 165 Music" });
      if (error) throw error;
      setToken(next);
      setMessage("Key created. Copy it now into your watch build; it is only shown here once.");
    } catch {
      setMessage("Couldn't create a watch key. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!supabase || !user) return;
    setBusy(true);
    const { error } = await supabase
      .from("watch_devices")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("revoked_at", null);
    setBusy(false);
    if (error) {
      setMessage("Couldn't disconnect watches. Try again.");
      return;
    }
    setToken("");
    setMessage("All watch keys disconnected. Cached items stay on the watch, but cannot sync.");
  }

  return (
    <div className="mt-5 flex flex-col gap-3 border-t border-line/60 pt-5">
      <Subheading title="Garmin watch" />
      <p className="text-[13px] text-ink-soft">
        Datebook on your Forerunner: assignments, events and progress, even without your phone. Sync
        uses Garmin Connect over Bluetooth when your phone has internet.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-xl border border-line px-4 py-2.5 text-[13px] disabled:opacity-50"
          disabled={busy}
          onClick={generate}
        >
          Create watch key
        </button>
        <button
          className="rounded-xl border border-line px-4 py-2.5 text-[13px] text-ink-soft disabled:opacity-50"
          disabled={busy}
          onClick={revoke}
        >
          Disconnect watches
        </button>
      </div>
      {token && (
        <label className="text-[13px] text-ink-soft">
          Watch key
          <input
            className="mt-2 w-full rounded-lg border border-line bg-surface p-3 font-mono text-xs"
            readOnly
            value={token}
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
      )}
      <p className="text-xs text-ink-faint">
        A watch key can read your calendar and update items. Keep it private. Disconnecting revokes
        every key immediately. Build and USB installation instructions are in the repository’s watch
        folder.
      </p>
      {message && (
        <p role="status" className="text-[13px] text-ink-soft">
          {message}
        </p>
      )}
    </div>
  );
}
