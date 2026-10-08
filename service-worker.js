const CACHE_NAME = "link-hub-v1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./admin.html",
  "./manifest.json",
  "./avatar.jpg",
  "./icon-192.png",
  "./icon-512.png"
];

// Install
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );

  self.skipWaiting();
});

// Activate
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );

  self.clients.claim();
});

// Fetch
self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only handle GET requests
  if (request.method !== "GET") return;

  // Don't interfere with Firebase requests
  if (
    request.url.includes("firebaseio.com") ||
    request.url.includes("firestore.googleapis.com") ||
    request.url.includes("googleapis.com")
  ) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then((networkResponse) => {
          // Cache successful same-origin responses
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type === "basic"
          ) {
            const responseClone = networkResponse.clone();

            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }

          return networkResponse;
        })
        .catch(() => {
          // Offline fallback
          return caches.match("./index.html");
        });
    })
  );
});