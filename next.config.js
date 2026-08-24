// Baseline security headers applied to every response. camera + geolocation are
// allowed for 'self' because the app uses the camera for photos and GPS for evidence.
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=()' },
]

// Content-Security-Policy scoped to what the app actually loads: self, Supabase
// (REST + realtime websockets + storage images), Google Fonts, and data:/blob:
// (generated PDFs, photo blobs). 'unsafe-inline' is still required by Next/Tailwind
// without a nonce setup (removing it needs a nonce+middleware rollout). 'unsafe-eval'
// has been DROPPED: the Next 16 webpack PRODUCTION bundle doesn't eval(), so this
// closes the eval()-based injection vector. 'wasm-unsafe-eval' is NOT that vector —
// it permits WebAssembly compilation only, and is required because the client-side
// PDF path (@react-pdf/renderer -> yoga-layout 3.x, a wasm-only flexbox engine) calls
// WebAssembly.instantiate(). Without it the cargo report export dies with
// "Aborted(CompileError: WebAssembly.instantiate()...)". Never widen this to
// 'unsafe-eval'. frame-ancestors/object-src/base-uri/
// form-action add the high-value clickjacking + injection protections. Enforced in
// production only so it never interferes with the dev server's HMR websocket.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.supabase.co",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "worker-src 'self' blob:",
  // The in-app document viewer frames a PDF attachment (the pre-hire ship's particulars
  // and crew list arrive as PDFs). blob: ONLY: the app downloads the bytes itself over
  // connect-src and frames the blob, so this never permits framing a remote URL. There
  // is no object-src counterpart on purpose — <object>/<embed> stay 'none'.
  "frame-src 'self' blob:",
  "manifest-src 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@react-pdf/renderer', 'sharp'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        port: '',
        pathname: '/storage/v1/object/**',
      },
    ],
  },
  async headers() {
    const headers = [...securityHeaders]
    if (process.env.NODE_ENV === 'production') headers.push({ key: 'Content-Security-Policy', value: csp })
    return [{ source: '/:path*', headers }]
  },
}

module.exports = nextConfig
