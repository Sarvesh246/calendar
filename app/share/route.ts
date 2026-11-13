import { NextResponse, type NextRequest } from "next/server";

/**
 * Web Share Target landing (see `share_target` in manifest.json). A shared
 * title/text/link is folded into one line and handed to the quick-add composer
 * through the same `?intent=add&text=` deep link the iOS shell uses.
 */
export function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const text = [p.get("title"), p.get("text"), p.get("url")]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);
  const target = new URL("/today", request.nextUrl.origin);
  target.searchParams.set("intent", "add");
  if (text) target.searchParams.set("text", text);
  return NextResponse.redirect(target, 303);
}
