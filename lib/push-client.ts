import { authHeaders } from "./auth-headers";

export function vapidPublicKey(): string | undefined {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  return key && key.length > 20 ? key : undefined;
}

function urlBase64ToUint8Array(base64: string): BufferSource {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Before sign-out: drop this browser's server row for the account (while the
 * session can still authenticate the request) and the browser subscription
 * itself, so the next person to use this browser doesn't get these reminders.
 */
export async function unsubscribePush(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    // `getRegistration`, not `ready` — `ready` never settles without a worker.
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await fetch("/api/push/subscribe", {
      method: "DELETE",
      headers: await authHeaders(),
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => undefined);
    // Even if that request failed, a dead endpoint gets a 410 on the next
    // dispatch and the server row is pruned then.
    await sub.unsubscribe();
  } catch {
    /* sign-out must not fail on push cleanup */
  }
}

export type PushSubscribeResult = { ok: true } | { ok: false; error: string };

export async function subscribePush(): Promise<PushSubscribeResult> {
  const key = vapidPublicKey();
  if (!key) return { ok: false, error: "Push notifications aren't configured on this server." };
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, error: "This browser doesn't support push notifications." };
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      }));
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return { ok: false, error: "Couldn't read the push subscription from this browser." };
    }
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 401) {
        return { ok: false, error: "Sign in to enable closed-app reminder alerts." };
      }
      return { ok: false, error: body || `Subscribe failed (${res.status})` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Push subscribe failed." };
  }
}
