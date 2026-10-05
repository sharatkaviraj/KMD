// Cache public assets only. Protected pages, private JSON and mutations stay online.
const CACHE = "vppsone-public-v5";
const PRECACHE = ["/offline.html", "/manifest.webmanifest", "/branding/icon-192.png", "/branding/icon-512.png"];
let writes = 0;
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE))));
self.addEventListener("message", event => { if (event.data?.type === "ACTIVATE_UPDATE") self.skipWaiting(); });
self.addEventListener("activate", event => event.waitUntil((async () => {
  if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
  const names = await caches.keys();
  await Promise.all(names.filter(name => name !== CACHE && /^(vppsone-public-|vpps-fee-admin-|vpps-navigation-data-|vpps-student-index-)/.test(name)).map(name => caches.delete(name)));
  await self.clients.claim();
})()));
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try { return await event.preloadResponse || await fetch(request); }
      catch { return await caches.match("/offline.html") || Response.error(); }
    })());
    return;
  }
  const buildAsset = url.pathname.startsWith("/_next/static/");
  if (!buildAsset && !PRECACHE.includes(url.pathname) && !url.pathname.startsWith("/branding/")) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached && buildAsset) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        const clone = response.clone();
        event.waitUntil((async () => {
          await cache.put(request, clone);
          if (++writes % 20 === 0) {
            const keys = await cache.keys();
            const removable = keys.filter(key => !PRECACHE.includes(new URL(key.url).pathname));
            await Promise.all(removable.slice(0, Math.max(0, keys.length - 160)).map(key => cache.delete(key)));
          }
        })());
      }
      return response;
    } catch { return cached || Response.error(); }
  })());
});
