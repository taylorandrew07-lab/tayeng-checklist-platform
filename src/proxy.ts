import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PROTECTED_PREFIXES = ['/admin', '/surveyor', '/client', '/office']

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isProtected = PROTECTED_PREFIXES.some(p => pathname.startsWith(p))
  if (!isProtected) return NextResponse.next()

  // Refresh session cookies and check authentication
  const response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Is there a Supabase auth session cookie at all? (chunked as sb-<ref>-auth-token[.N])
  const hasAuthCookie = request.cookies.getAll().some(c => c.name.startsWith('sb-') && c.name.includes('-auth-token'))

  // getUser() validates the token over the network AND refreshes it (writing fresh
  // cookies via setAll). But on flaky mobile connections that network call fails and
  // returns no user — which previously bounced a perfectly-valid session to /login
  // (the "it logged me out, pull-to-refresh fixes it" complaint). So: only redirect
  // when there's genuinely NO session cookie. If a cookie exists but validation
  // failed (network), let the request through — the client layout re-checks the
  // session and RLS still guards every row, so nothing is exposed.
  let user = null
  try { user = (await supabase.auth.getUser()).data.user } catch { /* transient — treat as "still signed in" */ }

  if (!user && !hasAuthCookie) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
}
