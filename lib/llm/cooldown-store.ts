import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Provider cooldowns that survive a cold start.
 *
 * A 429 puts a provider on a 15-minute cooldown, but that used to live in a
 * `Map` on one serverless instance: the next cold start (or the next instance)
 * forgot it and sent the same doomed request again. The existing `rate_limits`
 * table is the durable store the quotas already use, so a cooldown is a row
 * there — `window_start` holds the moment it ends. Everything here is best
 * effort: with no service key, or if the table is unavailable, the in-memory
 * cooldown is simply all there is, exactly as before.
 */

const PREFIX = "llm-cooldown:";

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return null;
  return createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Provider id -> cooldown end (ms since epoch), for cooldowns still running. */
export async function loadDurableCooldowns(now = Date.now()): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const sb = client();
  if (!sb) return out;
  try {
    const { data } = await sb
      .from("rate_limits")
      .select("key, window_start")
      .like("key", `${PREFIX}%`);
    for (const row of data ?? []) {
      const until = +new Date(String(row.window_start));
      if (Number.isFinite(until) && until > now)
        out.set(String(row.key).slice(PREFIX.length), until);
    }
  } catch {
    /* durable store unavailable: memory is all we have */
  }
  return out;
}

export async function persistDurableCooldown(providerId: string, untilMs: number): Promise<void> {
  const sb = client();
  if (!sb) return;
  try {
    await sb
      .from("rate_limits")
      .upsert({
        key: `${PREFIX}${providerId}`,
        window_start: new Date(untilMs).toISOString(),
        count: 1,
      });
  } catch {
    /* best effort */
  }
}

/** The later of what this instance knows and what the store says. */
export function mergeCooldowns(
  local: Map<string, number>,
  durable: Map<string, number>,
): Map<string, number> {
  const out = new Map(local);
  for (const [id, until] of durable) {
    if (until > (out.get(id) ?? 0)) out.set(id, until);
  }
  return out;
}
