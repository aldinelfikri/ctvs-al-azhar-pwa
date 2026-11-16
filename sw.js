
"use strict";

// ======================================================
// TICKET VALIDATION SYSTEM
// AL-AZHAR FESTIVAL 2026
// SERVICE WORKER v4
// ======================================================

const CACHE_NAME = "ctvs-alazhar-v4";

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
      .then(async cache => {
        for (const file of APP_FILES) {
          try {
            await cache.add(file);
          } catch (error) {
            console.warn("Cache file gagal:", file, error);
          }
        }
      })
      .then(() => self.skipWaiting())
  );
});

// ======================================================
// ACTIVATE
// ======================================================

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith("ctvs-alazhar-"))
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ======================================================
// FETCH
// ======================================================

self.addEventListener("fetch", event => {
  const request = event.request;

  // Hanya GET yang boleh menggunakan cache.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Jangan pernah cache Google Apps Script.
  if (
    url.hostname === "script.google.com" ||
    url.hostname === "script.googleusercontent.com"
  ) {
    return;
  }

  // Abaikan permintaan lintas domain.
  if (url.origin !== self.location.origin) return;

  // Abaikan permintaan non-HTTP.
  if (!["http:", "https:"].includes(url.protocol)) return;

  event.respondWith(
    (async () => {
      try {
        // Network-first agar aplikasi memperoleh versi terbaru.
        const response = await fetch(request);

        if (
          response &&
          response.status === 200 &&
          response.type === "basic"
        ) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }

        return response;

      } catch (error) {
        // Jika offline, cari versi cache.
        const cached = await caches.match(request);

        if (cached) return cached;

        // Fallback halaman utama untuk navigasi.
        if (request.mode === "navigate") {
          const fallback = await caches.match("./index.html");

          if (fallback) return fallback;
        }

        return new Response(
          "Aplikasi sedang offline dan file belum tersedia di cache.",
          {
            status: 503,
            statusText: "Offline",
            headers: {
              "Content-Type": "text/plain; charset=utf-8"
            }
          }
        );
      }
    })()
  );
});
