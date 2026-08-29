// Datebook service worker — reminder notifications only.
// No fetch handler / offline caching: this exists so reminder notifications can
// be shown from registration.showNotification() (which keeps working when the
// tab is backgrounded on mobile) and so tapping one focuses the app.

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
      icon: "/icon.svg",
      badge: "/icon.svg",
      data: { itemId: data.itemId },
      actions: [
        { action: "open", title: "Open" },
        { action: "snooze", title: "Snooze 15 min" },
      ],
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  const itemId = event.notification.data?.itemId || "";
  event.notification.close();
  const path = event.action === "snooze" && itemId ? `/today?snooze=${encodeURIComponent(itemId)}` : "/agenda";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client) {
            client.focus();
            if (event.action === "snooze" && itemId && "navigate" in client) {
              return client.navigate(path);
            }
            return;
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(path);
      })
  );
});
