import { NextResponse } from "next/server";
import { clientKey, getRequestUser, rateLimit, tooMany } from "@/lib/api-guard";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const TIMEOUT_MS = 12_000;

/** Block loopback / link-local / private ranges so the feed URL can't be used to
 *  probe internal services (basic SSRF hardening). */
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h === "0.0.0.0" ||
    h === "::1"
  ) {
    return true;
  }
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./.test(h)) return true; // CGNAT
  if (/^::ffff:(127\.|10\.|192\.168\.|169\.254\.)/i.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^(0|fc|fd)[0-9a-f]*:/.test(h)) return true; // unique-local / unspecified IPv6
  return false;
}

function normalize(input: string): URL | null {
  const trimmed = input.trim().replace(/^webcal:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url;
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  const ip = clientKey(request);
  const limitKey = user ? `import:user:${user.id}` : `import:ip:${ip}`;
  if (!rateLimit(limitKey, user ? 30 : 12, 60 * 60 * 1000) || !rateLimit(`${limitKey}:burst`, 4, 60_000)) {
    return tooMany();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const rawUrl = (body as { url?: unknown })?.url;
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return NextResponse.json({ ok: false, error: "Paste a calendar feed URL." }, { status: 400 });
  }

  const url = normalize(rawUrl);
  if (!url) {
    return NextResponse.json(
      { ok: false, error: "That doesn't look like a valid http(s) or webcal link." },
      { status: 400 }
    );
  }
  if (isBlockedHost(url.hostname)) {
    return NextResponse.json({ ok: false, error: "That address isn't allowed." }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Datebook calendar import",
        Accept: "text/calendar, text/plain;q=0.9, */*;q=0.8",
      },
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = err instanceof Error && err.name === "AbortError";
    return NextResponse.json(
      { ok: false, error: aborted ? "The feed took too long to respond." : "Couldn't reach that URL." },
      { status: 502 }
    );
  }
  clearTimeout(timer);

  // Re-check after any redirects.
  try {
    if (isBlockedHost(new URL(res.url).hostname)) {
      return NextResponse.json({ ok: false, error: "That address isn't allowed." }, { status: 400 });
    }
  } catch {
    /* keep original url */
  }

  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: `The feed responded with ${res.status}. Double-check the link.` },
      { status: 502 }
    );
  }

  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "That calendar is too large to import." }, { status: 413 });
  }

  const text = await readLimited(res, MAX_BYTES);
  if (text == null) {
    return NextResponse.json({ ok: false, error: "That calendar is too large to import." }, { status: 413 });
  }
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    return NextResponse.json(
      { ok: false, error: "That link didn't return a calendar feed (no iCalendar data found)." },
      { status: 422 }
    );
  }

  // Return the raw feed and let the client parse it — floating and all-day dates
  // must resolve in the viewer's timezone, not this server's.
  return NextResponse.json({ ok: true, text });
}

async function readLimited(res: Response, maxBytes: number): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    return text.length > maxBytes ? null : text;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
