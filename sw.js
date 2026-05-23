const CACHE_NAME = 'planta-mble-v2';
const ASSETS = [
  '/planta2.html',
  '/admin.html',
  '/manifest.json',
  '/manifest-admin.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/js/supabase-config.js',
  '/js/auth.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Network-first para HTML y JSON (datos siempre frescos)
  // Cache-first para imágenes/CSS/JS estáticos
  const url = new URL(event.request.url);

  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    // No cachear las llamadas a la API, siempre fresco
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
