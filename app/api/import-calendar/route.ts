import { NextResponse } from "next/server";
import {
  clientKey,
  durableHourlyLimit,
  getRequestUser,
  rateLimit,
  sameOrigin,
  tooMany,
} from "@/lib/api-guard";
import { assertPublicHostname, isBlockedHost, normalizeFeedInput } from "@/lib/ssrf";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 5;

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "That request wasn't allowed." }, { status: 403 });
  }

  const user = await getRequestUser(request);
  const ip = clientKey(request);
  const limitKey = user ? `import:user:${user.id}` : `import:ip:${ip}`;
  const hourly = user ? 30 : 12;
  if (
    !rateLimit(limitKey, hourly, 60 * 60 * 1000) ||
    !rateLimit(`${limitKey}:burst`, 4, 60_000) ||
    !(await durableHourlyLimit(limitKey, hourly))
  ) {
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
  if (rawUrl.length > 2048) {
    return NextResponse.json({ ok: false, error: "That link is too long." }, { status: 400 });
  }

  const start = normalizeFeedInput(rawUrl);
  if (!start) {
    return NextResponse.json(
      { ok: false, error: "That doesn't look like a valid http(s) or webcal link." },
      { status: 400 }
    );
  }

  let current = start;
  let res: Response | null = null;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (isBlockedHost(current.hostname)) {
        return NextResponse.json({ ok: false, error: "That address isn't allowed." }, { status: 400 });
      }
      try {
        await assertPublicHostname(current.hostname);
      } catch (err) {
        const reason = err instanceof Error ? err.message : "";
        return NextResponse.json(
          {
            ok: false,
            error:
              reason === "unresolved-host"
                ? "Couldn't look up that host."
                : "That address isn't allowed.",
          },
          { status: 400 }
        );
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        res = await fetch(current, {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "User-Agent": "Datebook calendar import",
            Accept: "text/calendar, text/plain;q=0.9, */*;q=0.8",
          },
        });
      } catch (err) {
        const aborted = err instanceof Error && err.name === "AbortError";
        return NextResponse.json(
          { ok: false, error: aborted ? "The feed took too long to respond." : "Couldn't reach that URL." },
          { status: 502 }
        );
      } finally {
        clearTimeout(timer);
      }

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc || hop === MAX_REDIRECTS) {
          return NextResponse.json({ ok: false, error: "The feed redirected too many times." }, { status: 502 });
        }
        current = new URL(loc, current);
        continue;
      }
      break;
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Couldn't reach that URL." }, { status: 502 });
  }

  if (!res) {
    return NextResponse.json({ ok: false, error: "Couldn't reach that URL." }, { status: 502 });
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
