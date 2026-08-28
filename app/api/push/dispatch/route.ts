import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Cron target: send due reminder pushes. No-ops unless VAPID + service role
 * are configured. Client-side timers remain the default delivery path.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!process.env.VAPID_PRIVATE_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: true, skipped: true, reason: "push-not-configured" });
  }
  return NextResponse.json({ ok: true, skipped: true, reason: "use-client-timers" });
}
