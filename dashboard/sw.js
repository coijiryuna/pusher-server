const CACHE = 'pusher-cache-v2'
const STATIC = ["/dashboard/"];

self.addEventListener('install', (e) => {
  self.skipWaiting()
  // allSettled: satu URL gagal tidak menggagalkan install
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.allSettled(STATIC.map((u) => c.add(u)))
    )
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) =>
      Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  const { request } = e
  // API calls — network only
  if (request.url.includes('/api/')) return
  // Static assets — cache first
  if (request.url.match(/\.(js|css|png|jpg|svg|woff2?)$/)) {
    e.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((res) => {
        const clone = res.clone()
        caches.open(CACHE).then((c) => c.put(request, clone))
        return res
      }))
    )
    return
  }
  // Dashboard SPA — network first, fallback to cache
  if (request.url.includes('/dashboard')) {
    e.respondWith(
      fetch(request).catch(() => caches.match('/dashboard/'))
    )
    return
  }
})
