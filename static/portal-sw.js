"use strict";
// Scope deliberately stays /static/: no backend route or Service-Worker-Allowed change.
const CACHE = "playroom-portal-shell-v196";
const SHELL = [
  "/static/declarative-ui.js?v=4",
  "/static/declarative-ui.css?v=4",
  "/static/storage-pages.js?v=4",
  "/static/portal-feedback.js?v=4",
  "/static/portal.html",
  "/static/common.css?v=17",
  "/static/portal.css?v=40",
  "/static/common.js?v=34",
  "/static/i18n.js?v=6",
  "/static/auth.js?v=19",
  "/static/experiments.js?v=16",
  "/static/experiments.css?v=57",
  "/static/push-notifications.js?v=3",
  "/static/tutorial-frame.js?v=1",
  "/static/portal.js?v=115",
  "/static/portal-chat-preview.js?v=7",
  "/static/images/arcade-bot.png",
  "/static/portal-match-layout.js?v=9",
  "/static/portal-speed.js?v=2",
  "/static/feedback-dialog.js?v=1",
  "/static/portal-match-layout.css?v=1",
  "/static/portal-speed.css?v=2",
  "/static/portal-practice.js?v=5",
  "/static/portal-offline.js?v=19",
  "/static/feedback-dialog.css?v=1",
  "/static/portal.webmanifest",
  "/static/portal-icon.svg",
  "/static/portal-install.js?v=2",
  "/static/portal-icon-180.png",
  "/static/portal-icon-192.png",
  "/static/portal-icon-512.png",
];
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches.open(CACHE).then(async (c) => {
      // One failed asset (a deploy mid-install, a flaky entry) must not
      // fail the whole offline shell: install what can be installed and
      // let the next load retry the rest.
      const results = await Promise.allSettled(SHELL.map((url) => c.add(url)));
      const failed = SHELL.filter((_, i) => results[i].status === "rejected");
      if (failed.length) {
        try {
          console.warn("Portal shell partially installed; retry on next load:", failed);
        } catch {}
      }
      await self.skipWaiting();
    }),
  ),
);
// An update deletes older shells and asks open portal pages to reload.
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      const old = (await caches.keys()).filter(
        (key) => key.startsWith("playroom-portal-shell-") && key !== CACHE,
      );
      await Promise.all(old.map((key) => caches.delete(key)));
      await self.clients.claim();
      if (!old.length) return;
      const pages = await self.clients.matchAll({ type: "window" });
      pages
        .filter((page) => new URL(page.url).pathname === "/static/portal.html")
        .forEach((page) => page.postMessage({type:"portal-shell-updated"}));
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  // Never cache API/auth requests or other students' pages.
  if (
    url.origin !== self.location.origin ||
    url.pathname !== "/static/portal.html" && !SHELL.includes(url.pathname + url.search) && !/^\/static\/avatars\/(users\/[^/]+|computers)\/[^/]+\.png$/.test(url.pathname)
  )
    return;
  // The page itself comes from the network when online, so a deploy shows up on the
  // next load; the saved copy is the offline fallback. The other files are versioned
  // (?v=N), so their saved copies never go stale.
  if (url.pathname === "/static/portal.html") {
    event.respondWith(
      (async () => {
        let response;
        try {
          response = await fetch(event.request, { cache: "no-cache" });
        } catch (error) {
          const cache = await caches.open(CACHE);
          const saved = await cache.match("/static/portal.html");
          if (saved) return saved;
          throw error;
        }
        if (response.ok) {
          try {
            const cache = await caches.open(CACHE);
            await cache.put("/static/portal.html", response.clone());
          } catch (error) { console.warn("Could not cache portal page:", error); }
        }
        return response;
      })(),
    );
    return;
  }
  event.respondWith(
    (async () => {
      let cache;
      try {
        cache = await caches.open(CACHE);
        const saved = await cache.match(event.request);
        if (saved) {
          if (url.pathname.startsWith("/static/avatars/")) {
            try { await cache.delete(event.request); await cache.put(event.request, saved.clone()); }
            catch (error) { console.warn("Could not update avatar cache:", error); }
          }
          return saved;
        }
      } catch (error) { console.warn("Could not read portal cache:", error); }
      const response = await fetch(event.request);
      if (cache && response.ok && url.pathname.startsWith("/static/avatars/")) {
        try {
          const avatars = (await cache.keys()).filter(request => new URL(request.url).pathname.startsWith("/static/avatars/"));
          while (avatars.length >= 50) await cache.delete(avatars.shift());
          await cache.put(event.request, response.clone());
        } catch (error) { console.warn("Could not cache avatar:", error); }
      }
      return response;
    })(),
  );
});

// Web push: the server sends {title, body, url, tag} (see push.py), already localized
// for the subscriber. The worker only displays it; the payload carries no credentials.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "Game platform", {
      body: payload.body || "",
      tag: payload.tag,
      renotify: true,
      icon: "/static/portal-icon.svg",
      data: { url: payload.url || "/static/portal.html" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/static/portal.html";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const portal = clients.find((client) =>
          client.url.includes("/static/portal.html"),
        );
        if (portal) return portal.focus().then(() => portal.navigate(url));
        return self.clients.openWindow(url);
      }),
  );
});
