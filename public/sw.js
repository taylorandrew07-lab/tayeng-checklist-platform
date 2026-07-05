/* Minimal service worker for offline app-shell + previously-visited pages.
   Never caches Supabase (cross-origin) or same-origin /api responses, so
   private API/auth/storage data is never stored. */
const VERSION = 'v5'
const STATIC_CACHE = `tayeng-static-${VERSION}`
const PAGE_CACHE = `tayeng-pages-${VERSION}`
const OFFLINE_URL = '/offline'

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(PAGE_CACHE).then((cache) => cache.add(OFFLINE_URL)).catch(() => {}),
      // Precache the logo so offline-generated cargo PDFs always include it,
      // even if the user never loaded a page that referenced it first.
      caches.open(STATIC_CACHE).then((cache) => cache.add('/logo-full.png')).catch(() => {}),
    ])
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
          if (res.ok) {
            const copy = res.clone()
            caches.open(STATIC_CACHE).then((c) => c.put(request, copy))
          }
          return res
        })
      )
    )
    return
  }

  // Page navigations: ONLY manage the offline-relevant staff routes
  // (/surveyor, /admin). Every other route — /inbox, /office, /client, /profile,
  // etc. — is left to the browser to fetch natively, so the SW can never turn a
  // normal online navigation into a "couldn't load" error. For the staff routes:
  // network-first, fall back to the cached page, then the offline page.
  if (request.mode === 'navigate') {
    const cacheable = url.pathname.startsWith('/surveyor') || url.pathname.startsWith('/admin')
    if (!cacheable) return // native browser handling for all non-offline routes
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(PAGE_CACHE).then((c) => c.put(request, copy))
          }
          return res
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match(OFFLINE_URL)))
    )
    return
  }

  // Static public assets ONLY (manifest, icons, fonts, images): cache-first.
  // Everything else — RSC payloads, prefetches, dynamic data GETs — is passed
  // straight to the network and never stored, so no private data is cached.
  const isStaticAsset =
    url.pathname === '/manifest.json' ||
    /\.(?:png|jpe?g|svg|webp|gif|ico|woff2?|ttf|otf)$/i.test(url.pathname)
  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached || fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(STATIC_CACHE).then((c) => c.put(request, copy))
          }
          return res
        })
      )
    )
  }
})
