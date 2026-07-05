import { NextResponse, type NextRequest } from 'next/server'

const PROTECTED_PREFIXES = ['/admin', '/surveyor', '/client', '/office']

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isProtected = PROTECTED_PREFIXES.some(p => pathname.startsWith(p))
  if (!isProtected) return NextResponse.next()

  // Gate on the presence of a Supabase auth session cookie (chunked as
  // sb-<ref>-auth-token[.N]) — nothing more. We deliberately do NOT call
  // supabase.auth.getUser() here anymore:
  //   - Its return value never affected the redirect (the old check was
  //     `!user && !hasAuthCookie`, so a present cookie always let the request
  //     through and an absent one always redirected — user was irrelevant).
  //   - But getUser() rotated the refresh token on EVERY protected navigation,
  //     racing the browser client's own auto-refresh. A stale rotated token can
  //     trip Supabase's reuse detection and revoke the whole session — an
  //     intermittent, hard-to-diagnose logout. Removing it makes the browser the
  //     single, Web-Lock-serialised refresher.
  // Security is unchanged: no cookie → still redirected to /login, and RLS remains
  // the authoritative gate on every row for any request that gets through.
  const hasAuthCookie = request.cookies.getAll().some(c => c.name.startsWith('sb-') && c.name.includes('-auth-token'))

  if (!hasAuthCookie) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
}
