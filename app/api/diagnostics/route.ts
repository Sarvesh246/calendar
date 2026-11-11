import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { clientKey, durableHourlyLimit, rateLimit, sameOrigin } from "@/lib/api-guard";

const metric = z
  .object({
    type: z.enum([
      "interaction",
      "event_timing",
      "long_task",
      "layout_shift",
      "navigation",
      "resource",
      "error",
    ]),
    at: z.number().int().nonnegative(),
    route: z.enum(["today", "calendar", "agenda", "schedule", "settings", "other"]),
    kind: z
      .enum([
        "click",
        "pointer",
        "key",
        "input",
        "other",
        "api",
        "document",
        "script",
        "style",
        "image",
        "error",
        "rejection",
      ])
      .optional(),
    action: z
      .enum([
        "today",
        "calendar",
        "agenda",
        "schedule",
        "settings",
        "assistant",
        "search",
        "filter",
        "add",
        "send",
        "other",
      ])
      .optional(),
    duration: z.number().finite().min(0).max(600000).optional(),
    delay: z.number().finite().min(0).max(600000).optional(),
    value: z.number().finite().min(0).max(1000000).optional(),
  })
  .strict();
const batch = z
  .object({
    device: z.string().uuid(),
    session: z.string().uuid(),
    events: z.array(metric).min(1).max(40),
  })
  .strict();

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return new Response(null, { status: 415 });
  if (Number(request.headers.get("content-length") || 0) > 16000)
    return new Response(null, { status: 413 });
  const key = `diagnostics:${clientKey(request)}`;
  if (
    !rateLimit(key, 12, 60000) ||
    !(await durableHourlyLimit(key, 180, { failClosed: true, requireAtomic: true })) ||
    !(await durableHourlyLimit("diagnostics:global", 5000, {
      failClosed: true,
      requireAtomic: true,
    }))
  )
    return new Response(null, { status: 429 });
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const decoder = new TextDecoder();
  let raw = "";
  let bytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 16000) {
      void reader.cancel();
      return new Response(null, { status: 413 });
    }
    raw += decoder.decode(value, { stream: true });
  }
  raw += decoder.decode();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }
  const parsed = batch.safeParse(json);
  if (!parsed.success) return new Response(null, { status: 400 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return new Response(null, { status: 503 });
  const db = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await db.from("diagnostic_batches").insert({
    device_id: parsed.data.device,
    session_id: parsed.data.session,
    events: parsed.data.events,
  });
  return new Response(null, {
    status: error ? 503 : 204,
    headers: { "Cache-Control": "no-store" },
  });
}
