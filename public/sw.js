/* PoliGol service worker — instalable (PWA) + offline.
 * Estrategia NETWORK-FIRST: siempre intenta la red (contenido fresco, sin
 * staleness mientras hay conexión) y cae al cache solo offline. Cache versionada
 * que se limpia en activate. No intercepta WebSocket (no pasa por fetch). */
const CACHE = "poligol-v1";
const ASSETS = [
  "./",
  "index.html",
  "style.css",
  "client.js",
  "physics-core.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {})));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // solo same-origin
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match("index.html")))
  );
});
