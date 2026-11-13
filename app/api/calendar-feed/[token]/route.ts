import { createClient } from "@supabase/supabase-js";
import { FEED_TOKEN_PATTERN } from "@/lib/calendar-feed";
import { rowToItem } from "@/lib/db-sync";
import { serializeIcs } from "@/lib/ics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 1000;

function notFound() {
  // The same response for a malformed, unknown or revoked token, so the route
  // can't be used to probe which tokens exist.
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

/**
 * Read-only .ics feed of one user's Datebook, addressed by a secret token the
 * user generated in Settings. Calendar apps poll it, so Datebook items show up
 * live in Google / Apple / Outlook without re-downloading a file.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!FEED_TOKEN_PATTERN.test(token)) return notFound();
  if (!service || !url) return new Response("Feed not configured", { status: 503 });

  const supabase = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: owner } = await supabase
    .from("calendar_feed_tokens")
    .select("user_id")
    .eq("token", token)
    .maybeSingle();
  if (!owner?.user_id) return notFound();

  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("items")
      .select("*")
      .eq("user_id", owner.user_id)
      .order("at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return new Response("Couldn't read calendar", { status: 502 });
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < PAGE_SIZE) break;
  }

  const body = serializeIcs(rows.map((r) => rowToItem(r)));
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="datebook.ics"',
      // Calendar apps refresh on their own schedule; a short private cache
      // absorbs rapid re-polls without making edits feel slow to appear.
      "Cache-Control": "private, max-age=300",
    },
  });
}
