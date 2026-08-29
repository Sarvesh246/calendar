import { lookup } from "node:dns/promises";

/** Block loopback / link-local / private ranges so a feed URL can't probe internal services. */
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
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
  if (/^127\./.test(v4) || /^10\./.test(v4) || /^192\.168\./.test(v4) || /^169\.254\./.test(v4)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v4)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./.test(v4)) return true;
  if (/^(0|fc|fd)[0-9a-f]*:/.test(v)) return true;
  if (/^fe80:/i.test(v)) return true;
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
  return url;
}
