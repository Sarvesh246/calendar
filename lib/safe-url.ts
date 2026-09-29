/** Return a canonical external http(s) URL, or null for unsafe/invalid input. */
export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 2_048 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
