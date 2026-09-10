import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import {
  DEFAULT_CLASS_REMINDER_MINUTES,
  classReminderFor,
  normalizeClassReminderMinutes,
} from "@/lib/class-reminder";
import type { Item, Reminder, RepeatRule } from "@/lib/types";

export const runtime = "nodejs";

const WINDOW_MS = 25 * 60 * 1000; // GitHub Actions runs ~every 10m and can be late
const LOOKBACK_MS = 12 * 60 * 60 * 1000; // Catch reminders missed during cron gaps
// A class heads-up is the one alert whose timing is the whole point, so it gets
// a tighter band than the generic ±window: at most 5 minutes ahead of the
// chosen offset (a "10 minutes before" push landing 30 minutes early reads as a
// bug), and never once the meeting has already started.
const CLASS_EARLY_MS = 5 * 60 * 1000;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");

  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const pushConfigured = !!(vapidPublic && vapidPrivate && service && url);

  if (pushConfigured && (!secret || auth !== `Bearer ${secret}`)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  if (!pushConfigured) {
    return NextResponse.json({ ok: true, skipped: true, reason: "push-not-configured" });
  }

  webpush.setVapidDetails("mailto:datebook@local", vapidPublic, vapidPrivate);
  const supabase = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = Date.now();
  const horizon = now + WINDOW_MS;
  const lookback = now - LOOKBACK_MS;
  const maxOffsetMs = 24 * 60 * 60 * 1000;
  const atMin = new Date(lookback - maxOffsetMs).toISOString();
  const atMax = new Date(horizon + maxOffsetMs).toISOString();

  const { data: items, error: itemsErr } = await supabase
    .from("items")
    .select(
      "id, user_id, title, type, at, end_at, all_day, status, reminders, repeat, source_id"
    )
    // Events carry a NULL status, and `status <> 'done'` is NULL — not true —
    // for those rows, so a bare `.neq` silently dropped every event (classes
    // included) from closed-app push.
    .or("status.is.null,status.neq.done")
    .gte("at", atMin)
    .lte("at", atMax);
  if (itemsErr) {
    console.error("[push] items", itemsErr.message);
    return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 500 });
  }

  // Class meetings get their heads-up from settings rather than a stored
  // reminder, so the dispatcher has to read each user's chosen offset.
  const classMinutesByUser = await readClassReminderMinutes(
    supabase,
    [...new Set((items ?? []).map((row) => row.user_id as string))]
  );

  const due: { userId: string; item: Item; reminder: Reminder; key: string }[] = [];
  for (const row of items ?? []) {
    const userId = row.user_id as string;
    const stored = (row.reminders as Reminder[] | null) ?? [];
    const classReminder = classReminderFor(
      {
        id: row.id as string,
        type: row.type as Item["type"],
        allDay: Boolean(row.all_day),
        status: (row.status as Item["status"]) ?? undefined,
        reminders: stored,
        ...(row.source_id ? { sourceId: row.source_id as string } : {}),
        ...(row.repeat ? { repeat: row.repeat as RepeatRule } : {}),
      },
      classMinutesByUser.get(userId) ?? DEFAULT_CLASS_REMINDER_MINUTES
    );
    const reminders = classReminder ? [...stored, classReminder] : stored;
    if (!reminders.length) continue;
    const at = new Date(row.at as string).getTime();
    if (Number.isNaN(at)) continue;
    for (const r of reminders) {
      const fireAt = at - r.offsetMinutes * 60_000;
      if (r === classReminder) {
        if (fireAt > now + CLASS_EARLY_MS) continue; // a later run lands closer
        if (at <= now) continue; // class already under way — the alert is moot
      } else if (fireAt < lookback || fireAt > horizon) {
        continue;
      }
      const key = `${row.id}:${r.id || `o${r.offsetMinutes}`}:${Math.floor(fireAt / 60_000)}`;
      due.push({
        userId,
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
    const title = job.item.type === "event" ? job.item.title : `Due soon: ${job.item.title}`;
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

/**
 * Each user's chosen class heads-up offset, keyed by user id.
 *
 * Missing rows (and a project whose schema predates migration 0009, where the
 * column select fails outright) fall back to the default rather than dropping
 * class alerts entirely — same degrade-don't-stall posture as `STRIPPABLE_COLS`
 * on the client.
 */
async function readClassReminderMinutes(
  supabase: SupabaseClient,
  userIds: string[]
): Promise<Map<string, number>> {
  const byUser = new Map<string, number>();
  if (userIds.length === 0) return byUser;
  const { data, error } = await supabase
    .from("user_settings")
    .select("user_id, class_reminder_minutes")
    .in("user_id", userIds);
  if (error) {
    console.warn("[push] class reminder settings", error.message);
    return byUser;
  }
  for (const row of data ?? []) {
    byUser.set(
      row.user_id as string,
      normalizeClassReminderMinutes(row.class_reminder_minutes)
    );
  }
  return byUser;
}
