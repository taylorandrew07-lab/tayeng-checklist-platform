/* Minimal service worker for offline app-shell + previously-visited pages.
   Never caches Supabase (cross-origin) or same-origin /api responses, so
   private API/auth/storage data is never stored. */
const VERSION = 'v8'
const STATIC_CACHE = `tayeng-static-${VERSION}`
const PAGE_CACHE = `tayeng-pages-${VERSION}`
const OFFLINE_URL = '/offline'

// ── Offline app shell for cargo voyages ─────────────────────────────────────
//
// Pages are cached by exact URL, so a voyage CREATED at sea has a URL that was
// never fetched from the network: close the browser and the bookmark opens the
// offline page, even though every reading is safe in IndexedDB. Surveyors are
// offline for days, so that made the module unusable away from a signal.
//
// /surveyor/cargo/[id] is a client component that loads its voyage from
// IndexedDB, so the HTML is identical whatever the id — one cached copy serves
// every voyage. It is stored under a stable key here and served whenever a
// voyage page misses the cache.
//
// The workspace deliberately reads the id from window.location rather than from
// useParams(), because this shell carries the route tree of whatever URL it was
// originally fetched for. Without that, serving the shell would open the wrong
// voyage. The two changes only work together — see VoyageWorkspace.
const SHELL_KEY = '/__shell__/surveyor/cargo'
const SHELL_URL = '/surveyor/cargo/__shell__'

/** The shell key for a navigation, or null if it isn't a voyage page. */
function shellKeyFor(pathname) {
  const m = /^\/surveyor\/cargo\/([^/]+)\/?$/.exec(pathname)
  // 'new' is a real static route with its own page — never stand in for it.
  if (!m || m[1] === 'new') return null
  return SHELL_KEY
}

/** Fetch and store the shell. Guarded because a signed-out fetch REDIRECTS to
 *  /login, and caching that as the shell would show a login form to an offline
 *  surveyor forever. */
async function primeShell() {
  try {
    const res = await fetch(SHELL_URL, { credentials: 'same-origin' })
    if (!res.ok || res.redirected) return
    const cache = await caches.open(PAGE_CACHE)
    await cache.put(SHELL_KEY, res)
  } catch {
    // Offline right now — the navigate handler below fills it in from the first
    // voyage page that loads successfully.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(PAGE_CACHE).then((cache) => cache.add(OFFLINE_URL)).catch(() => {}),
      // Precache both logos so offline-generated cargo PDFs always include the
      // letterhead, even if the user never loaded a page that referenced it first.
      // logo-invoice.png is the PRINT logo the PDFs use (dark wordmark);
      // logo-full.png is the white-wordmark screen logo for the sidebar/auth pages.
      caches.open(STATIC_CACHE)
        .then((cache) => cache.addAll(['/logo-invoice.png', '/logo-full.png']))
        .catch(() => {}),
      primeShell(),
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
      // Re-prime after a version bump, since the old cache was just dropped.
      .then(() => primeShell())
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
  // network-first, fall back to the cached page, then the cargo shell, then the
  // offline page.
  if (request.mode === 'navigate') {
    const cacheable = url.pathname.startsWith('/surveyor') || url.pathname.startsWith('/admin')
    if (!cacheable) return // native browser handling for all non-offline routes
    const shellKey = shellKeyFor(url.pathname)
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const forPage = res.clone()
            // Every successful voyage page also refreshes the shell, so the
            // fallback stays in step with the deployed build.
            const forShell = shellKey ? res.clone() : null
            caches.open(PAGE_CACHE).then((c) => {
              c.put(request, forPage)
              if (forShell) c.put(SHELL_KEY, forShell)
            })
          }
          return res
        })
        .catch(async () => {
          const cached = await caches.match(request)
          if (cached) return cached
          if (shellKey) {
            const shell = await caches.match(shellKey)
            if (shell) return shell
          }
          return caches.match(OFFLINE_URL)
        })
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
