import { createClient } from "@supabase/supabase-js";

const hits = new Map<string, number[]>();

export const MAX_ASSISTANT_MESSAGE = 2_000;
export const MAX_ASSISTANT_ITEMS = 180;
export const MAX_ASSISTANT_BODY = 400_000;

export function clientKey(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") || "local";
}

/** True when the request looks like it came from this app (not a random curl). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const host = (origin || referer || "").trim();
  if (!host) return false;
  try {
    return hostAllowed(new URL(host).hostname);
  } catch {
    return false;
  }
}

function hostAllowed(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1") return true;
  if (h.endsWith(".vercel.app")) return true;
  const vercel = process.env.VERCEL_URL?.replace(/^https?:\/\//, "").split(":")[0]?.toLowerCase();
  if (vercel && h === vercel) return true;
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (site) {
    try {
      if (new URL(site).hostname.toLowerCase() === h) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/** True if the request is allowed. False = caller should 429. */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    hits.set(key, arr);
    return false;
  }
  arr.push(now);
  hits.set(key, arr);
  return true;
}

export async function getRequestUser(request: Request): Promise<{ id: string } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const auth = request.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id };
}

export function tooMany() {
  return Response.json(
    { error: "rate-limited", ok: false },
    { status: 429, headers: { "Retry-After": "30" } }
  );
}

/** Hourly cap stored in Supabase when a service role key is present. Fail-open. */
export async function durableHourlyLimit(key: string, max: number): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return true;
  try {
    const sb = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const hour = new Date();
    hour.setUTCMinutes(0, 0, 0);
    const { data } = await sb.from("rate_limits").select("count, window_start").eq("key", key).maybeSingle();
    const windowStart = data?.window_start ? new Date(data.window_start as string) : null;
    if (!data || !windowStart || windowStart < hour) {
      const { error } = await sb
        .from("rate_limits")
        .upsert({ key, window_start: hour.toISOString(), count: 1 });
      return !error;
    }
    if ((data.count as number) >= max) return false;
    const { error } = await sb
      .from("rate_limits")
      .update({ count: (data.count as number) + 1 })
      .eq("key", key);
    return !error;
  } catch {
    return true;
  }
}
