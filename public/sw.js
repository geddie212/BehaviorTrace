// public/sw.js
self.addEventListener("install", (e) => {
  console.log("Service worker installed");
});

self.addEventListener("fetch", (e) => {
  // Simple cache-first example
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
