"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase/client";
import { feedUrl, generateFeedToken, googleAddUrl, webcalUrl } from "@/lib/calendar-feed";
import { haptic } from "@/lib/haptic";
import { Subheading } from "./primitives";

const BUTTON =
  "rounded-xl border border-line px-4 py-2.5 text-[13px] font-medium text-ink-soft transition-colors hover:text-ink disabled:opacity-50";

/**
 * A live, subscribable .ics link for signed-in users, so Datebook items appear
 * in Google / Apple / Outlook calendars and stay current — unlike a one-off
 * .ics download. The URL contains a secret token: anyone with it can read the
 * calendar, so it can be reset (old link dies) or turned off.
 */
export function CalendarFeedSection() {
  const { user } = useAuth();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  const userId = user?.id;

  useEffect(() => {
    // Origin is only known in the browser; set after mount so SSR markup matches.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);

  const load = useCallback(async () => {
    if (!supabase || !userId) return;
    const { data, error } = await supabase
      .from("calendar_feed_tokens")
      .select("token")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      setToken(null);
      setMessage("Calendar links aren't available on this account yet.");
      return;
    }
    setToken(data?.token ?? null);
  }, [userId]);

  useEffect(() => {
    // Reads the signed-in user's saved link from the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!supabase || !user) return null;

  async function create() {
    if (!supabase || !userId) return;
    setBusy(true);
    setMessage(null);
    const next = generateFeedToken();
    const { error } = await supabase
      .from("calendar_feed_tokens")
      .upsert({ user_id: userId, token: next }, { onConflict: "user_id" });
    setBusy(false);
    if (error) {
      setMessage("Couldn't create the link. Try again in a moment.");
      return;
    }
    haptic("success");
    setToken(next);
  }

  async function turnOff() {
    if (!supabase || !userId) return;
    setBusy(true);
    const { error } = await supabase.from("calendar_feed_tokens").delete().eq("user_id", userId);
    setBusy(false);
    if (error) {
      setMessage("Couldn't turn the link off. Try again in a moment.");
      return;
    }
    setToken(null);
    setMessage("Link turned off. Calendars using it will stop updating.");
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      haptic("light");
      setMessage("Copied.");
    } catch {
      setMessage("Couldn't copy — select the link and copy it by hand.");
    }
  }

  return (
    <div className="mt-5 flex flex-col gap-2.5 border-t border-line/60 pt-4">
      <Subheading title="Live calendar link" />
      <p className="text-[12.5px] leading-relaxed text-ink-soft">
        Subscribe in Google, Apple or Outlook Calendar and your Datebook items stay up to date
        there. Anyone with the link can read your calendar, so don&apos;t share it.
      </p>
      {token === undefined ? null : token ? (
        <>
          <input
            readOnly
            value={origin ? feedUrl(origin, token) : ""}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Calendar feed link"
            className="field-control min-h-10 w-full rounded-md border border-line bg-surface px-2.5 py-2 text-[12.5px] text-ink"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={BUTTON}
              onClick={() => copy(feedUrl(origin, token))}
              disabled={!origin}
            >
              Copy link
            </button>
            <a className={BUTTON} href={origin ? webcalUrl(origin, token) : "#"}>
              Apple Calendar
            </a>
            <a
              className={BUTTON}
              href={origin ? googleAddUrl(origin, token) : "#"}
              target="_blank"
              rel="noopener noreferrer"
            >
              Google Calendar
            </a>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={BUTTON}
              disabled={busy}
              onClick={() => {
                if (confirm("Make a new link? Calendars using the current one will stop updating."))
                  void create();
              }}
            >
              Reset link
            </button>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => void turnOff()}>
              Turn off
            </button>
          </div>
        </>
      ) : (
        <div>
          <button type="button" className={BUTTON} disabled={busy} onClick={() => void create()}>
            Create link
          </button>
        </div>
      )}
      {message && (
        <p role="status" className="text-[12px] text-ink-faint">
          {message}
        </p>
      )}
    </div>
  );
}
