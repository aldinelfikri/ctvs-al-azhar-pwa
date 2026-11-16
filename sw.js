// ======================================================
// CTVS AL-AZHAR SERVICE WORKER
// ======================================================

const CACHE_NAME = "ctvs-alazhar-v1";

const APP_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest"
];

// ======================================================
// INSTALL
// ======================================================

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

// ======================================================
// ACTIVATE
// ======================================================

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => {
        return Promise.all(
          keys
            .filter(key => key.startsWith("ctvs-alazhar-"))
            .filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        );
      })
      .then(() => self.clients.claim())
  );
});

// ======================================================
// FETCH
// ======================================================

self.addEventListener("fetch", event => {
  const request = event.request;

  // Hanya menangani permintaan GET.
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  // Jangan cache endpoint Apps Script.
  if (
    url.hostname === "script.google.com" ||
    url.hostname === "script.googleusercontent.com"
  ) {
    return;
  }

  // Jangan cache permintaan di luar origin aplikasi.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Strategi network-first untuk file aplikasi:
  // jika jaringan gagal, gunakan cache.
  event.respondWith(
    fetch(request)
      .then(response => {
        if (
          response &&
          response.status === 200 &&
          response.type === "basic"
        ) {
          const copy = response.clone();

          caches.open(CACHE_NAME)
            .then(cache => cache.put(request, copy));
        }

        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);

        if (cached) {
          return cached;
        }

        if (request.mode === "navigate") {
          const fallback = await caches.match("./index.html");

          if (fallback) {
            return fallback;
          }
        }

        return new Response(
          "Aplikasi sedang offline dan file tidak tersedia di cache.",
          {
            status: 503,
            statusText: "Offline"
          }
        );
      })
  );
});
