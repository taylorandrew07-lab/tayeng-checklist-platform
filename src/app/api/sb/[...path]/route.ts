// Same-origin relay to Supabase, for networks that allow us but block them.
//
// WHY THIS EXISTS
// A surveyor on a ship's wifi could load the app but not sign in. The login probe
// said it exactly: `app=ok auth=failed` — the vessel's network reaches our Vercel
// domain and refuses nbszz….supabase.co. Offline-first does not help, because
// opening the app at all needs a session, and getting a session needs the one host
// the ship blocks. So the browser talks to us instead, and we forward.
//
// WHAT THIS DOES NOT DO — the whole security argument in one line:
// it relays the CALLER'S OWN credentials and adds nothing of its own.
//   * The service-role key is never read here and never sent. Only the apikey and
//     Authorization headers the browser already supplied are forwarded, and the
//     anon key is public (it ships in every client bundle) — so this endpoint
//     grants no capability that posting straight to supabase.co would not.
//   * RLS is untouched and remains the authoritative gate on every row.
//   * No cookie is forwarded, so our own session cookie never leaves the origin.
//   * The path is allowlisted, so this cannot be pointed at anything else.
//
// THE ONE REAL TRADEOFF, stated plainly: requests arriving through here reach
// Supabase from Vercel's IP, not the user's. Supabase's per-IP rate limiting on
// the auth endpoints — its brute-force and enumeration defence — therefore sees
// one address for every relayed caller. We forward X-Forwarded-For so it can still
// see the origin IP where it honours it, but that is a mitigation, not a guarantee.
// This is why the browser only falls back to this path when the direct connection
// has ALREADY failed (see lib/supabase/client.ts): normal users go direct, with
// their real IP and full rate limiting, and never touch this route.

import { NextResponse, type NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UPSTREAM = process.env.NEXT_PUBLIC_SUPABASE_URL

// Only the data planes the browser legitimately calls. Notably absent: anything
// admin-shaped. `auth/v1/admin/*` is service-role-only upstream and would be
// refused anyway, but an allowlist that has to be widened on purpose is a better
// place to make that decision than a 401 we happen to rely on.
const ALLOWED_PREFIXES = ['auth/v1/', 'rest/v1/', 'storage/v1/']

// Forwarded verbatim. `apikey` and `authorization` are the caller's own; the rest
// are PostgREST/Storage protocol headers that change what is returned, not who may
// see it. `cookie` is deliberately absent.
const FORWARD_REQUEST_HEADERS = [
  'apikey',
  'authorization',
  'content-type',
  'accept',
  'accept-profile',
  'content-profile',
  'prefer',
  'range',
  'x-client-info',
  'x-supabase-api-version',
  'x-upsert',
]

const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'content-range',
  'content-length',
  'range-unit',
  'x-supabase-api-version',
  'www-authenticate',
  'retry-after',
]

function denied() {
  // Deliberately identical for a bad path and a bad method: this endpoint should
  // not describe its own shape to someone probing it.
  return new NextResponse('Not found', { status: 404 })
}

async function relay(request: NextRequest, path: string[]) {
  if (!UPSTREAM) return denied()

  const joined = path.join('/')
  if (!ALLOWED_PREFIXES.some((p) => joined.startsWith(p))) return denied()
  // Defence in depth against a crafted [...path] climbing out of the allowlist.
  if (joined.includes('..')) return denied()

  // Browsers send Origin on every cross-origin request and on all same-origin
  // non-GETs. A mismatch is not something our own app can produce. This does not
  // stop a non-browser client (nothing here could) — it stops a page on another
  // site quietly using us as its relay.
  const origin = request.headers.get('origin')
  if (origin && origin !== request.nextUrl.origin) return denied()

  const target = new URL(`${UPSTREAM.replace(/\/+$/, '')}/${joined}`)
  target.search = request.nextUrl.search

  const headers = new Headers()
  for (const name of FORWARD_REQUEST_HEADERS) {
    const v = request.headers.get(name)
    if (v) headers.set(name, v)
  }
  // Give the upstream rate limiter the best view of the real caller we can.
  const client = request.headers.get('x-forwarded-for')
  if (client) headers.set('x-forwarded-for', client)

  const method = request.method
  const hasBody = method !== 'GET' && method !== 'HEAD'

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      // Pass a redirect back to the caller rather than following it here; the relay
      // should be transparent, not a decision-maker.
      redirect: 'manual',
      cache: 'no-store',
    })
  } catch {
    // We could not reach Supabase either. Report a gateway failure, not an auth
    // failure — misreporting this as a 401 would send the client into a credential
    // loop for what is an upstream outage.
    return new NextResponse('Upstream unreachable', { status: 502 })
  }

  const out = new Headers()
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const v = upstream.headers.get(name)
    if (v) out.set(name, v)
  }
  out.set('cache-control', 'no-store')

  return new NextResponse(upstream.body, { status: upstream.status, headers: out })
}

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(req: NextRequest, { params }: Ctx) { return relay(req, (await params).path) }
export async function HEAD(req: NextRequest, { params }: Ctx) { return relay(req, (await params).path) }
export async function POST(req: NextRequest, { params }: Ctx) { return relay(req, (await params).path) }
export async function PUT(req: NextRequest, { params }: Ctx) { return relay(req, (await params).path) }
export async function PATCH(req: NextRequest, { params }: Ctx) { return relay(req, (await params).path) }
export async function DELETE(req: NextRequest, { params }: Ctx) { return relay(req, (await params).path) }
