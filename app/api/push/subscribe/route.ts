import { NextResponse } from "next/server";
import { getRequestUser, sameOrigin } from "@/lib/api-guard";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ ok: false, error: "auth-required" }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, error: "not-configured" }, { status: 501 });

  let body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad-request" }, { status: 400 });
  }
  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json({ ok: false, error: "bad-request" }, { status: 400 });
  }

  const supabase = createClient(url, key, {
    global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
    },
    { onConflict: "user_id,endpoint" }
  );
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // One browser endpoint belongs to one account. A previous user of this
  // browser whose session was dropped rather than signed out still has a row
  // for it, and would keep getting their reminders pushed here. RLS only lets
  // us see our own rows, so this needs the service role; without it the stale
  // row lingers until the push service reports the endpoint gone.
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (service) {
    const admin = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: cleanupErr } = await admin
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", body.endpoint)
      .neq("user_id", user.id);
    if (cleanupErr) console.warn("[push] endpoint cleanup", cleanupErr.message);
  }
  return NextResponse.json({ ok: true });
}

/** Sign-out: stop pushing this account's reminders to this browser. */
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ ok: false, error: "auth-required" }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, error: "not-configured" }, { status: 501 });

  let body: { endpoint?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad-request" }, { status: 400 });
  }
  if (!body.endpoint) return NextResponse.json({ ok: false, error: "bad-request" }, { status: 400 });

  const supabase = createClient(url, key, {
    global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("endpoint", body.endpoint);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
