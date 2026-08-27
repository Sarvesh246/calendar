"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True when the two public env vars are set — the app runs in local-only mode otherwise. */
export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Browser Supabase client. Sessions live in localStorage and the magic-link
 * hash fragment is consumed automatically on load (`detectSessionInUrl`).
 * `null` when Supabase isn't configured, so callers must guard.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
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
