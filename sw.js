const CACHE = "helloqueue-v38";

const ASSETS = [
  "/",
  "/index.html",
  "/login.html",
  "/register.html",
  "/dashboard.html",
  "/attendee.html",
  "/display.html",
  "/404.html",
  "/404.css",
  "/style.css",
  "/script.js",
  "/lib/gftv-request-signing.js",
  "/views/queues.js",
  "/views/events.js",
  "/views/queue-operator.js",
  "/views/profile.js",
  "/views/admin-users.js",
  "/GHQ-main.png",
  "/GHQ-192.png",
  "/GHQ-512.png",
  "/favicon.ico",
  "/manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetched = fetch(event.request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        return response;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});
