// Bump on every change to anything this worker serves. The browser compares
// this file byte for byte, so a version left alone is an update nobody is
// ever prompted about. See update-bar-spec.md.
const CACHE = "helloqueue-v44";

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

// The update bar (sw-register.js) posts "skip-waiting" when a person presses
// Reload. The message is either that string or an object with a `type`.
self.addEventListener("message", (event) => {
  let messageType;
  if (typeof event.data === "string") {
    messageType = event.data;
  } else if (event.data) {
    messageType = event.data.type;
  }

  if (messageType === "skip-waiting") {
    event.waitUntil(self.skipWaiting().then(() => self.clients.claim()));
  }
});

// Stale while revalidate: answer from the cache when there's a copy, and
// fetch a fresh copy into the cache either way, for the next visit. With no
// cached copy, the answer is the network response.
self.addEventListener("fetch", (event) => {
  // The cache only holds GET responses; cache.put rejects anything else.
  if (event.request.method !== "GET") {
    return;
  }

  // API responses are never cached — they are live data and must always come
  // from the network.
  if (new URL(event.request.url).pathname.startsWith("/api/")) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetched = fetch(event.request).then((response) => {
        const responseCopy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, responseCopy));
        return response;
      }).catch(() => cached);

      if (cached) {
        return cached;
      }
      return fetched;
    })
  );
});
