import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  // DEMO MODE: allow all routes through without auth
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch {
    // Supabase unreachable — treat as unauthenticated
  }

  const pathname = request.nextUrl.pathname
  const publicPaths = ['/login', '/auth/callback']
  const isPublicPath = publicPaths.some((p) => pathname.startsWith(p))

  if (!user && !isPublicPath) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    return NextResponse.redirect(loginUrl)
  }

  if (user && pathname === '/login') {
    const homeUrl = request.nextUrl.clone()
    homeUrl.pathname = '/'
    return NextResponse.redirect(homeUrl)
  }

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const role = profile?.role

    if (pathname.startsWith('/admin') && role !== 'admin') {
      const url = request.nextUrl.clone()
      url.pathname = role === 'surveyor' ? '/surveyor' : '/client'
      return NextResponse.redirect(url)
    }

    if (pathname.startsWith('/surveyor') && role !== 'surveyor' && role !== 'admin') {
      const url = request.nextUrl.clone()
      url.pathname = '/client'
      return NextResponse.redirect(url)
    }

    if (pathname.startsWith('/client') && role !== 'client' && role !== 'admin') {
      const url = request.nextUrl.clone()
      url.pathname = role === 'surveyor' ? '/surveyor' : '/admin'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|icons/|api/auth).*)',
  ],
}
