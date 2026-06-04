/* Minimal service worker for offline app-shell + previously-visited pages.
   Never caches Supabase (cross-origin) or same-origin /api responses, so
   private API/auth/storage data is never stored. */
const VERSION = 'v1'
const STATIC_CACHE = `tayeng-static-${VERSION}`
const PAGE_CACHE = `tayeng-pages-${VERSION}`
const OFFLINE_URL = '/offline'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PAGE_CACHE).then((cache) => cache.add(OFFLINE_URL)).catch(() => {})
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => ![STATIC_CACHE, PAGE_CACHE].includes(k)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Only our own origin — never intercept Supabase or any cross-origin request.
  if (url.origin !== self.location.origin) return
  // Never cache same-origin API/auth routes.
  if (url.pathname.startsWith('/api/')) return

  // Hashed Next static assets: cache-first.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached || fetch(request).then((res) => {
          const copy = res.clone()
          caches.open(STATIC_CACHE).then((c) => c.put(request, copy))
          return res
        })
      )
    )
    return
  }

  // Page navigations: network-first, fall back to cached page, then offline page.
  // Only CACHE the offline-relevant surveyor routes so private client/admin
  // pages are never stored on the device.
  if (request.mode === 'navigate') {
    const cacheable = url.pathname === OFFLINE_URL || url.pathname.startsWith('/surveyor')
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (cacheable && res.ok) {
            const copy = res.clone()
            caches.open(PAGE_CACHE).then((c) => c.put(request, copy))
          }
          return res
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match(OFFLINE_URL)))
    )
    return
  }

  // Other same-origin GETs (manifest, icons, fonts): stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(STATIC_CACHE).then((c) => c.put(request, copy))
          return res
        })
        .catch(() => cached)
      return cached || network
    })
  )
})
