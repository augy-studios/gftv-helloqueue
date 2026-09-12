// Bump on every change to anything this worker serves. The browser compares
// this file byte for byte, so a version left alone is an update nobody is
// ever prompted about. See update-bar-spec.md.
const CACHE = "helloqueue-v41";

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
  "/official-bar.js",
  "/sw-register.js",
  "/lib/gftv-request-signing.js",
  "/views/queues.js",
  "/views/events.js",
  "/views/queue-operator.js",
  "/views/profile.js",
  "/views/admin-users.js",
  "/assets/fonts/ProximaNova-Regular.woff2",
  "/gftv-flag.png",
  "/GHQ-main.png",
  "/GHQ-192.png",
  "/GHQ-512.png",
  "/favicon.ico",
  "/manifest.json"
];

// No skipWaiting() here and no clients.claim() in activate: a new worker
// installs and then waits until a person presses Reload on the update bar.
// The only place either is called is the message handler below.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
      )
    )
  );
});

self.addEventListener("message", (event) => {
  const type = typeof event.data === "string" ? event.data : event.data?.type;

  if (type === "skip-waiting") {
    event.waitUntil(self.skipWaiting().then(() => self.clients.claim()));
  }
});

self.addEventListener("fetch", (event) => {
  // The cache only holds GET responses; cache.put rejects anything else.
  if (event.request.method !== "GET") return;

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
