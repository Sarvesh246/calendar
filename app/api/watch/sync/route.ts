import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { clientKey, rateLimit, tooMany } from "@/lib/api-guard";
import { watchBatch, watchItem, WATCH_LIMIT } from "@/lib/watch";
import { courseLabels } from "@/lib/course-name";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers });
}

async function authenticate(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (!token || !/^dbw_[a-f0-9]{64}$/.test(token)) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Watch sync is not configured");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db
    .from("watch_devices")
    .select("id,user_id")
    .eq("token_hash", createHash("sha256").update(token).digest("hex"))
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  return data ? { db, owner: data.user_id as string, device: data.id as string } : null;
}

export async function GET(request: Request) {
  if (!rateLimit(`watch:${clientKey(request)}`, 120, 60_000)) return tooMany();
  try {
    const auth = await authenticate(request);
    if (!auth) return reply({ error: "unauthorized" }, 401);
    const { db, owner } = auth;
    const query = new URL(request.url).searchParams;
    // Page membership is fixed by the first response. Concurrent phone edits
    // cannot shift offsets and make assignments disappear between pages.
    if (query.has("ids")) {
      const ids = query.get("ids")!.split(",");
      if (ids.length > 5 || ids.some((id) => !/^[a-f0-9-]{36}$/.test(id)))
        return reply({ error: "invalid-page" }, 400);
      const [rows, classes] = await Promise.all([
        db.from("items").select("*").eq("user_id", owner).in("id", ids),
        db.from("categories").select("id,name,color").eq("user_id", owner).eq("archived", false),
      ]);
      if (rows.error || classes.error) throw new Error("snapshot-failed");
      const names = new Map([...courseLabels(classes.data ?? [])].map(([id, c]) => [id, c.label]));
      return reply({
        items: (rows.data ?? [])
          .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
          .map((r) => watchItem(r, names)),
      });
    }
    const now = new Date();
    const past = new Date(now.getTime() - 30 * 86400_000).toISOString();
    const future = new Date(now.getTime() + 90 * 86400_000).toISOString();
    const [open, dated, classes] = await Promise.all([
      db
        .from("items")
        .select("*")
        .eq("user_id", owner)
        .in("type", ["assignment", "task"])
        .or("status.is.null,status.neq.done")
        .order("at")
        .limit(WATCH_LIMIT),
      db
        .from("items")
        .select("*")
        .eq("user_id", owner)
        .gte("at", past)
        .lte("at", future)
        .order("at")
        .limit(500),
      db.from("categories").select("id,name,color").eq("user_id", owner).eq("archived", false),
    ]);
    if (open.error || dated.error || classes.error) throw new Error("snapshot-failed");
    const names = new Map([...courseLabels(classes.data ?? [])].map(([id, c]) => [id, c.label]));
    const rows = new Map<string, Record<string, unknown>>();
    // Keep all available open work first. Completed history never crowds it out.
    for (const r of open.data ?? []) rows.set(r.id, r);
    const rest = [...(dated.data ?? [])].sort((a, b) => {
      const rank = (r: typeof a) => {
        const distance = Date.parse(r.at) - now.getTime();
        if (Math.abs(distance) < 2 * 86400_000) return 0;
        return r.type === "event" && distance >= 0 ? 1 : 2;
      };
      return (
        rank(a) - rank(b) ||
        Math.abs(Date.parse(a.at) - now.getTime()) - Math.abs(Date.parse(b.at) - now.getTime())
      );
    });
    for (const r of rest) if (rows.size < WATCH_LIMIT) rows.set(r.id, r);
    const items = [...rows.values()].map((r) => watchItem(r, names));
    const summary = query.get("summary") === "1";
    const page = Math.max(0, Math.min(19, Number(query.get("page")) || 0));
    return reply({
      version: 1,
      syncedAt: Math.floor(now.getTime() / 1000),
      items: summary ? [] : items.slice(page * 5, page * 5 + 5),
      ids: summary ? [] : items.map((i) => i.id),
      page,
      pages: Math.max(1, Math.ceil(items.length / 5)),
      classes: summary
        ? []
        : (classes.data ?? []).map((c) => ({ ...c, name: names.get(c.id) ?? c.name })),
      open: (open.data ?? []).length,
      limited:
        (open.data?.length ?? 0) >= WATCH_LIMIT ||
        new Set([...(dated.data ?? []), ...(open.data ?? [])].map((r) => r.id)).size > rows.size,
      next: items.find((i) => i.status !== "done" && i.type !== "event")?.title ?? "All caught up",
    });
  } catch {
    return reply({ error: "sync-unavailable" }, 503);
  }
}

export async function POST(request: Request) {
  if (!rateLimit(`watch-write:${clientKey(request)}`, 90, 60_000)) return tooMany();
  try {
    const auth = await authenticate(request);
    if (!auth) return reply({ error: "unauthorized" }, 401);
    if (Number(request.headers.get("content-length") ?? 0) > 16000)
      return reply({ error: "too-large" }, 413);
    const text = await request.text();
    if (text.length > 16000) return reply({ error: "too-large" }, 413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return reply({ error: "invalid-changes" }, 400);
    }
    const parsed = watchBatch.safeParse(body);
    if (!parsed.success) return reply({ error: "invalid-changes" }, 400);
    const results = [];
    for (const operation of parsed.data.changes) {
      const { data, error } = await auth.db.rpc("apply_watch_operation", {
        p_user: auth.owner,
        p_device: auth.device,
        p_op: operation,
      });
      if (error) throw error;
      results.push({ id: operation.id, ...data });
    }
    return reply({ results });
  } catch {
    return reply({ error: "sync-unavailable" }, 503);
  }
}
