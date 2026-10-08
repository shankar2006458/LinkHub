const VERSION    = "v3";                       // <-- bump this string on every deploy
const CACHE_NAME = `link-hub-${VERSION}`;

// Must exist. If any of these 404 the install still succeeds (they're fetched individually).
const APP_SHELL = [
  "./",
  "./index.html",
  "./admin.html",
  "./manifest.json"
];

// Nice to have. Missing files are ignored.
const OPTIONAL_ASSETS = [
  "./avatar.jpg",
  "./icon-192.png",
  "./icon-512.png"
];

// Never intercept these — let the browser talk to Firebase / Google directly.
const BYPASS_HOSTS = [
  "firestore.googleapis.com",
  "firebaseio.com",
  "firebaseapp.com",
  "googleapis.com",
  "gstatic.com",
  "jsdelivr.net",
  "cdn.tailwindcss.com"
];

/* ---------------- install ---------------- */
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Required shell — fail install only if one of THESE is missing.
    await Promise.all(
      APP_SHELL.map(async (url) => {
        try {
          const res = await fetch(url, { cache: "reload" });
          if (res && res.ok) await cache.put(url, res);
        } catch (_) { /* ignore individual failures */ }
      })
    );

    // Optional assets — best effort, never fatal.
    await Promise.all(
      OPTIONAL_ASSETS.map(async (url) => {
        try {
          const res = await fetch(url, { cache: "reload" });
          if (res && res.ok) await cache.put(url, res);
        } catch (_) { /* ignore */ }
      })
    );

    // Activate the new worker as soon as it's installed.
    await self.skipWaiting();
  })());
});

/* ---------------- activate ---------------- */
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Delete old versions of our cache.
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith("link-hub-") && n !== CACHE_NAME)
        .map((n) => caches.delete(n))
    );

    // Take control of already-open tabs immediately.
    await self.clients.claim();
  })());
});

/* ---------------- fetch ---------------- */
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // 1. Only GET.
  if (req.method !== "GET") return;

  // 2. Only http(s). Skips chrome-extension://, file://, data:, etc.
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // 3. Never touch Firebase / CDN / fonts traffic.
  if (BYPASS_HOSTS.some((h) => url.hostname.endsWith(h))) return;

  // 4. Cross-origin (anything not ours) -> straight to network, no caching.
  if (url.origin !== self.location.origin) return;

  // 5. Navigations (page loads / refreshes) -> network-first.
  if (req.mode === "navigate") {
    event.respondWith(handleNavigation(req));
    return;
  }

  // 6. Everything else same-origin -> stale-while-revalidate.
  event.respondWith(handleAsset(req));
});

/* ---------------- handlers ---------------- */

async function handleNavigation(req) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const fresh = await fetch(req);
    // Only cache a genuinely successful HTML response.
    if (fresh && fresh.ok && fresh.type === "basic") {
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (_) {
    // Offline: try the exact page, then index.html, then a minimal fallback.
    const exact = await cache.match(req, { ignoreSearch: true });
    if (exact) return exact;

    const index = await cache.match("./index.html", { ignoreSearch: true });
    if (index) return index;

    return new Response(
      "<!doctype html><meta charset=utf-8><title>Offline</title>" +
      "<body style='font-family:system-ui;padding:2rem;text-align:center'>" +
      "<h1>You're offline</h1><p>Reconnect and reload the page.</p></body>",
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}

async function handleAsset(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);

  // Kick off a background refresh while returning the cached copy.
  const networkFetch = fetch(req)
    .then((res) => {
      if (res && res.ok && res.type === "basic") {
        cache.put(req, res.clone());
      }
      return res;
    })
    .catch(() => null);

  if (cached) return cached;

  const fresh = await networkFetch;
  if (fresh) return fresh;

  // Real "not found" for asset requests — never return HTML for a JS/CSS/img request.
  return new Response("", { status: 504, statusText: "Offline" });
}

/* ---------------- messages from the page (optional) ---------------- */
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
