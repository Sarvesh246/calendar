import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

export function assistantDatabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  cached =
    url && service
      ? createClient(url, service, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;
  return cached;
}
