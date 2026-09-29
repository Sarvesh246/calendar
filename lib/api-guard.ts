import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

/** Request timestamps per client key, trimmed to the active window. */
const hits = new Map<string, number[]>();
/** Guards against the map growing one entry per client IP for the life of a
 *  warm serverless instance — a key whose window has fully lapsed is dropped
 *  rather than kept forever holding an empty array. */
const MAX_TRACKED_CLIENTS = 5_000;
let warnedMissingAtomicRateLimit = false;

function evictStale(now: number, windowMs: number) {
  for (const [key, times] of hits) {
    if (times.length === 0 || now - times[times.length - 1] >= windowMs) hits.delete(key);
  }
}

export { MAX_SYLLABUS_BODY, MAX_SYLLABUS_PDF_BYTES } from "./syllabus-limits";

export const MAX_ASSISTANT_MESSAGE = 2_000;
/** Hard ceiling after open-work is always kept; events fill the remainder. */
export const MAX_ASSISTANT_ITEMS = 600;
export const MAX_ASSISTANT_BODY = 400_000;
/** Per signed-in user, not global — a class can import the same week in parallel. */
export const SYLLABUS_HOURLY_AUTH = 30;
/** Per anonymous IP only (campus NAT). Signed-in users never share this bucket. */
export const SYLLABUS_HOURLY_ANON = 20;
/** Per-user (or per-IP if anonymous) per minute. Must absorb Gemini retries + a tap-again. */
export const SYLLABUS_BURST = 8;

/** Rate-limit bucket: one key per user, or per IP when nobody is signed in. */
export function syllabusLimitKey(user: { id: string } | null, ip: string): string {
  return user ? `syllabus:user:${user.id}` : `syllabus:ip:${ip}`;
}

export function clientKey(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  const raw = fwd?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  // Durable quota rows should not become a long-lived IP-address log. The salt
  // is server-only and stable across deployments; rate-limit keys remain useful
  // without retaining the caller's network identifier in Supabase.
  const salt =
    process.env.RATE_LIMIT_SALT ||
    process.env.CRON_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "datebook-local";
  return `client:${createHmac("sha256", salt).update(raw).digest("hex").slice(0, 24)}`;
}

/** True when the request looks like it came from this app (not a random curl). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const source = (origin || referer || "").trim();
  if (!source) return false;
  try {
    const sourceUrl = new URL(source);
    const targetUrl = new URL(request.url);
    const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
      return false;
    }
    if (sourceUrl.protocol !== "https:" && !isLocalHost(sourceUrl.hostname)) return false;
    return sourceUrl.origin === targetUrl.origin && hostAllowed(targetUrl.hostname);
  } catch {
    return false;
  }
}

function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

function hostAllowed(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (isLocalHost(h)) return true;
  // This deployment's own hosts only. Any `*.vercel.app` used to pass, which let
  // every other site on Vercel drive the Gemini-backed routes from its visitors.
  const own = [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ].map((v) => v?.replace(/^https?:\/\//, "").split(/[:/]/)[0]?.toLowerCase());
  if (own.includes(h)) return true;
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
  if (hits.size >= MAX_TRACKED_CLIENTS) evictStale(now, windowMs);
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
    { status: 429, headers: { "Retry-After": "30", "Cache-Control": "private, no-store" } }
  );
}

export function authenticationRequired() {
  return Response.json(
    { error: "authentication-required", ok: false },
    { status: 401, headers: { "Cache-Control": "private, no-store" } }
  );
}

export function isJsonRequest(request: Request): boolean {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.startsWith("application/json");
}

/** Constant-time comparison for cron/webhook bearer credentials. */
export function safeSecretEqual(actual: string | null, expected: string | undefined): boolean {
  if (!actual || !expected) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Hourly cap stored in Supabase when a service role key is present. */
export async function durableHourlyLimit(
  key: string,
  max: number,
  opts: { failClosed?: boolean; windowMs?: number } = {}
): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return !opts.failClosed;
  try {
    const sb = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const windowMs = Math.max(1_000, opts.windowMs ?? 60 * 60_000);
    const { data: allowed, error: rpcError } = await sb.rpc("consume_rate_limit", {
      p_key: key,
      p_max: max,
      p_window_seconds: Math.ceil(windowMs / 1_000),
    });
    if (!rpcError && typeof allowed === "boolean") return allowed;
    // Deployments that have not applied 0016 yet still retain the per-instance
    // user, client, and global guards above. Do not turn that rollout ordering
    // issue into a total AI outage; fail closed for every other database error.
    if (rpcError?.code === "PGRST202" || rpcError?.code === "42883") {
      if (!warnedMissingAtomicRateLimit) {
        warnedMissingAtomicRateLimit = true;
        console.warn("[rate-limit] atomic quota migration is not applied");
      }
      return true;
    }
    if (opts.failClosed) return false;

    // Backward-compatible fail-open path for non-sensitive routes while older
    // projects apply the atomic quota migration.
    const hour = new Date();
    hour.setUTCMinutes(0, 0, 0);
    const { data } = await sb.from("rate_limits").select("count, window_start").eq("key", key).maybeSingle();
    const windowStart = data?.window_start ? new Date(data.window_start as string) : null;
    if (!data || !windowStart || windowStart < hour) {
      // Fail-open: a store blip must not 429 a class mid-import.
      await sb.from("rate_limits").upsert({ key, window_start: hour.toISOString(), count: 1 });
      return true;
    }
    if ((data.count as number) >= max) return false;
    await sb.from("rate_limits").update({ count: (data.count as number) + 1 }).eq("key", key);
    return true;
  } catch {
    return !opts.failClosed;
  }
}
