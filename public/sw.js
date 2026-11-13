// Datebook service worker.
//  1. Reminder notifications (push + click handling).
//  2. App-shell caching, so the installed PWA opens with no network. Data is
//     already local (localStorage); this makes the *code* that reads it local too.
//
// Bump VERSION when this file's caching rules change. Hashed /_next/static
// assets are immutable, so they never need a bump of their own.

const VERSION = "v1";
const SHELL_CACHE = `datebook-shell-${VERSION}`;
const STATIC_CACHE = `datebook-static-${VERSION}`;

// Pages precached on install (best effort — one failure must not abort the rest).
const SHELL_ROUTES = ["/today", "/calendar", "/agenda", "/schedule", "/settings"];
const SHELL_ASSETS = ["/manifest.json", "/icon.svg", "/icon-192.png", "/icon-512.png"];

// Never cached: API calls, OAuth round trips.
const BYPASS_PREFIXES = ["/api/", "/auth", "/share"];

const pageKey = (url) => new Request(url.origin + url.pathname);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      await Promise.allSettled([
        ...SHELL_ROUTES.map((p) => shell.add(p)),
        ...SHELL_ASSETS.map((p) => shell.add(p)),
      ]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, STATIC_CACHE]);
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith("datebook-") && !keep.has(n)).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

async function networkFirstPage(request) {
  const url = new URL(request.url);
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    // Cache by pathname so `?intent=…` deep links share one entry.
    if (response.ok) cache.put(pageKey(url), response.clone());
    return response;
  } catch {
    const hit =
      (await cache.match(pageKey(url))) ||
      (await cache.match("/today")) ||
      (await cache.match("/agenda"));
    if (hit) return hit;
    return new Response("Datebook is offline and this page hasn't been saved yet.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (BYPASS_PREFIXES.some((p) => url.pathname.startsWith(p))) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }
  if (/\.(?:png|svg|ico|webp|woff2?)$/.test(url.pathname) || url.pathname === "/manifest.json") {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  }
});

self.addEventListener("push", (event) => {
  let data = { title: "Datebook", body: "You have a reminder.", itemId: "" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* ignore */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag || "datebook-push",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { itemId: data.itemId },
      actions: [
        { action: "open", title: "Open" },
        { action: "snooze", title: "Snooze 15 min" },
      ],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  const itemId = event.notification.data?.itemId || "";
  event.notification.close();
  // Snooze acts on the item; a plain tap opens that item. With no id (older
  // pushes) fall back to the agenda.
  let path = "/agenda";
  if (itemId) {
    const id = encodeURIComponent(itemId);
    path = event.action === "snooze" ? `/today?snooze=${id}` : `/agenda?intent=item&item=${id}`;
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.focus();
          // An open tab won't reload, so route it to the deep link.
          if (itemId && "navigate" in client) return client.navigate(path);
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(path);
    }),
  );
});
