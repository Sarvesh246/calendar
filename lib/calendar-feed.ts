/** Shape of a feed token: 32 random bytes, base64url. Checked server-side before any lookup. */
export const FEED_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A fresh, unguessable feed token (256 bits). */
export function generateFeedToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The https URL a calendar app subscribes to. */
export function feedUrl(origin: string, token: string): string {
  return `${origin}/api/calendar-feed/${token}`;
}

/** Same feed as `webcal://` — Apple Calendar opens this straight into "Subscribe". */
export function webcalUrl(origin: string, token: string): string {
  return feedUrl(origin, token).replace(/^https?:/, "webcal:");
}

/** Google Calendar's "add by URL" deep link. */
export function googleAddUrl(origin: string, token: string): string {
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl(origin, token))}`;
}
