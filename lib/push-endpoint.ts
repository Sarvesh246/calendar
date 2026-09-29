import { assertPublicHostname, isBlockedHost } from "./ssrf";

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const TRUSTED_PUSH_HOSTS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "web.push.apple.com",
];

function isTrustedPushHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    TRUSTED_PUSH_HOSTS.includes(host) ||
    host.endsWith(".push.apple.com") ||
    host.endsWith(".notify.windows.com")
  );
}

export function parsePushEndpoint(value: unknown): URL | null {
  if (typeof value !== "string" || value.length < 12 || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (url.port && url.port !== "443") return null;
    if (isBlockedHost(url.hostname) || !isTrustedPushHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export async function validPushEndpoint(value: unknown): Promise<boolean> {
  const url = parsePushEndpoint(value);
  if (!url) return false;
  try {
    await assertPublicHostname(url.hostname);
    return true;
  } catch {
    return false;
  }
}

export function validPushKey(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.length >= min && value.length <= max && BASE64URL.test(value);
}
