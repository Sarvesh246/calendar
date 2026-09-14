"use client";

const KEY = "datebook-client-id";

/**
 * A random id generated once per browser and persisted in localStorage. It is
 * not identity or auth — it exists only so the server's anonymous rate limits
 * can tell apart different guests who happen to share one IP address (a dorm,
 * a lecture hall's WiFi during syllabus week) instead of merging everyone on
 * that network into a single quota.
 */
export function getClientId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return undefined;
  }
}
