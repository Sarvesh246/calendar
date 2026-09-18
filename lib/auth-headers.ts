import { supabase } from "./supabase/client";
import { getClientId } from "./client-id";

async function accessToken(): Promise<string | undefined> {
  if (!supabase) return undefined;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token;
  } catch {
    return undefined;
  }
}

/** `X-Client-Id`, sent on every request so the server's anonymous rate limits
 *  can separate guests sharing one IP instead of bucketing them together. Only
 *  matters when there's no access token — an authenticated request is already
 *  keyed by user id — but it costs nothing to send either way. */
function clientIdHeaders(): Record<string, string> {
  const clientId = getClientId();
  return clientId ? { "X-Client-Id": clientId } : {};
}

/** Attach the signed-in access token when we have one (browser only). */
export async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...clientIdHeaders(),
  };
  const token = await accessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Bearer token only — for `FormData` uploads. Do not set `Content-Type`;
 * the browser has to supply the multipart boundary.
 */
export async function authBearerHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...clientIdHeaders() };
  const token = await accessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
