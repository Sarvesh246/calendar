import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import type { Item, Reminder } from "@/lib/types";

export const runtime = "nodejs";

const WINDOW_MS = 25 * 60 * 1000; // GitHub Actions runs ~every 10m and can be late
const LOOKBACK_MS = 12 * 60 * 60 * 1000; // Catch reminders missed during cron gaps

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!vapidPublic || !vapidPrivate || !service || !url) {
    return NextResponse.json({ ok: true, skipped: true, reason: "push-not-configured" });
  }

  webpush.setVapidDetails("mailto:datebook@local", vapidPublic, vapidPrivate);
  const supabase = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = Date.now();
  const horizon = now + WINDOW_MS;
  const lookback = now - LOOKBACK_MS;

  const { data: items, error: itemsErr } = await supabase
    .from("items")
    .select("id, user_id, title, type, at, end_at, all_day, status, reminders")
    .neq("status", "done");
  if (itemsErr) {
    console.error("[push] items", itemsErr.message);
    return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 500 });
  }

  const due: { userId: string; item: Item; reminder: Reminder; key: string }[] = [];
  for (const row of items ?? []) {
    const reminders = (row.reminders as Reminder[] | null) ?? [];
    if (!reminders.length) continue;
    const at = new Date(row.at as string).getTime();
    if (Number.isNaN(at)) continue;
    for (const r of reminders) {
      const fireAt = at - r.offsetMinutes * 60_000;
      if (fireAt < lookback || fireAt > horizon) continue;
      const key = `${row.id}:${r.id || `o${r.offsetMinutes}`}:${Math.floor(fireAt / 60_000)}`;
      due.push({
        userId: row.user_id as string,
        reminder: r,
        key,
        item: {
          id: row.id as string,
          categoryId: "",
          type: row.type as Item["type"],
          title: row.title as string,
          at: new Date(row.at as string).toISOString(),
          createdAt: new Date().toISOString(),
          ...(row.end_at ? { endAt: new Date(row.end_at as string).toISOString() } : {}),
          ...(row.all_day ? { allDay: true } : {}),
          ...(row.status ? { status: row.status as Item["status"] } : {}),
        },
      });
    }
  }

  if (due.length === 0) return NextResponse.json({ ok: true, sent: 0 });

  const keys = due.map((d) => d.key);
  const { data: already } = await supabase.from("reminder_sends").select("key").in("key", keys);
  const sentKeys = new Set((already ?? []).map((r) => r.key as string));

  const userIds = [...new Set(due.filter((d) => !sentKeys.has(d.key)).map((d) => d.userId))];
  if (userIds.length === 0) return NextResponse.json({ ok: true, sent: 0 });

  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("user_id, endpoint, p256dh, auth")
    .in("user_id", userIds);

  const byUser = new Map<string, { endpoint: string; keys: { p256dh: string; auth: string } }[]>();
  for (const s of subs ?? []) {
    const list = byUser.get(s.user_id as string) ?? [];
    list.push({
      endpoint: s.endpoint as string,
      keys: { p256dh: s.p256dh as string, auth: s.auth as string },
    });
    byUser.set(s.user_id as string, list);
  }

  let sent = 0;
  for (const job of due) {
    if (sentKeys.has(job.key)) continue;
    const targets = byUser.get(job.userId) ?? [];
    if (targets.length === 0) continue;
    const title = job.item.type === "event" ? job.item.title : `Due soon — ${job.item.title}`;
    const body = `${job.reminder.label} · ${job.item.title}`;
    const payload = JSON.stringify({
      title,
      body,
      tag: `datebook-${job.item.id}`,
      itemId: job.item.id,
    });
    let delivered = false;
    for (const sub of targets) {
      try {
        await webpush.sendNotification(sub, payload);
        delivered = true;
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          await supabase
            .from("push_subscriptions")
            .delete()
            .eq("user_id", job.userId)
            .eq("endpoint", sub.endpoint);
        } else {
          console.warn("[push] send failed", status);
        }
      }
    }
    if (delivered) {
      await supabase.from("reminder_sends").upsert({ key: job.key, sent_at: new Date().toISOString() });
      sent += 1;
    }
  }

  return NextResponse.json({ ok: true, sent });
}
