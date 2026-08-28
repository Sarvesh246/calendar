// Datebook service worker — reminder notifications only.
// No fetch handler / offline caching: this exists so reminder notifications can
// be shown from registration.showNotification() (which keeps working when the
// tab is backgrounded on mobile) and so tapping one focuses the app.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client) return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow("/agenda");
      })
  );
});
