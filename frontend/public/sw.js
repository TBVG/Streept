const CACHE = "streept-shell-v4";
const RUNTIME = "streept-runtime-v2";
const SHELL = ["/", "/index.html", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isDocument = request.mode === "navigate" || request.destination === "document";
  const isStatic = ["script", "style", "font", "worker", "manifest"].includes(request.destination);
  const isApiGet = url.pathname.startsWith("/api/");

  if (isDocument) {
    event.respondWith(
      fetch(request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, clone));
        return response;
      }).catch(() => caches.match(request).then((cached) => cached || caches.match("/index.html")))
    );
    return;
  }

  if (isApiGet) {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(RUNTIME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => caches.match(request).then((cached) => {
        if (cached) return cached;
        return new Response(JSON.stringify({ success: false, offline: true, error: { message: "Offline and no cached response is available." } }), {
          status: 503, headers: { "Content-Type": "application/json" }
        });
      }))
    );
    return;
  }

  if (isStatic) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((response) => {
          if (response.ok) caches.open(RUNTIME).then((cache) => cache.put(request, response.clone()));
          return response;
        });
        return cached || network;
      })
    );
  }
});
