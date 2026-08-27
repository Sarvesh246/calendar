"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
// Supabase's newer "publishable" key (sb_publishable_…) or the legacy anon JWT —
// both are browser-safe and gated by row-level security.
const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True when the URL + key env vars are set — the app runs in local-only mode otherwise. */
export const isSupabaseConfigured = Boolean(url && key);

/**
 * Browser Supabase client. Sessions live in localStorage and the magic-link
 * hash fragment is consumed automatically on load (`detectSessionInUrl`).
 * `null` when Supabase isn't configured, so callers must guard.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, key as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Implicit flow (token in URL hash) so a magic link works even when
        // opened on a different device than the one that requested it.
        detectSessionInUrl: true,
        flowType: "implicit",
      },
    })
  : null;
