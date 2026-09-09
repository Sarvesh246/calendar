import { supabase } from "./supabase/client";

async function accessToken(): Promise<string | undefined> {
  if (!supabase) return undefined;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token;
  } catch {
    return undefined;
  }
}

/** Attach the signed-in access token when we have one (browser only). */
export async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = await accessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Bearer token only — for `FormData` uploads. Do not set `Content-Type`;
 * the browser has to supply the multipart boundary.
 */
export async function authBearerHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const token = await accessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
