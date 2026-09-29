import { lookup } from "node:dns/promises";

/** Block loopback / link-local / private ranges so a feed URL can't probe internal services. */
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".home.arpa") ||
    h.endsWith(".test") ||
    h.endsWith(".invalid") ||
    h.endsWith(".example") ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h === "metadata.google.internal"
  ) {
    return true;
  }
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./.test(h)) return true; // CGNAT
  if (/^::ffff:(127\.|10\.|192\.168\.|169\.254\.)/i.test(h)) return true;
  if (/^(0|fc|fd)[0-9a-f]*:/.test(h)) return true;
  return isBlockedIp(h);
}

export function isBlockedIp(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v === "::1" || v === "0.0.0.0" || v === "::") return true;
  const v4 = v.startsWith("::ffff:") ? v.slice(7) : v;
  const octets = v4.split(".").map(Number);
  if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [a, b, c] = octets;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && (b === 0 || b === 168)) return true;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    return false;
  }
  // Only globally routable IPv6 (2000::/3) is useful for a public feed. Block
  // unique-local, link-local, multicast, transition, documentation and other
  // special ranges rather than trying to enumerate every reserved prefix.
  if (v.includes(":")) return !/^[23][0-9a-f]{0,3}:/.test(v) || /^2001:db8:/i.test(v);
  return false;
}

export async function assertPublicHostname(hostname: string): Promise<void> {
  if (isBlockedHost(hostname)) {
    throw new Error("blocked-host");
  }
  let records: { address: string }[];
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("unresolved-host");
  }
  if (!records.length) throw new Error("unresolved-host");
  for (const rec of records) {
    if (isBlockedIp(rec.address)) throw new Error("blocked-host");
  }
}

export function normalizeFeedInput(input: string): URL | null {
  const trimmed = input.trim().replace(/^webcal:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port && !((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80"))) {
    return null;
  }
  url.hash = "";
  return url;
}
