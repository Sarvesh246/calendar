/**
 * What a sync failure means for you, in words. The raw server message (a
 * Postgres error and its code) used to be the whole explanation.
 */
export function friendlySyncError(raw: string | null): string {
  const text = raw ?? "";
  if (/failed to fetch|networkerror|network request|load failed|offline|timed? ?out/i.test(text)) {
    return "Can't reach the server right now. Your changes are saved on this device and will sync when you're back online.";
  }
  if (/jwt|token|expired|401|not authenticated|invalid claim/i.test(text)) {
    return "Your sign-in has expired. Sign out and back in to keep syncing — nothing on this device is lost.";
  }
  if (/permission denied|42501|row-level|rls/i.test(text)) {
    return "Your account couldn't save these changes. They're still on this device.";
  }
  if (/pgrst204|column .* (does not exist|not found)/i.test(text)) {
    return "The server needs an update before it can save some details. Everything else keeps syncing.";
  }
  return "Couldn't sync just now. Your changes are safe on this device and will be retried.";
}
