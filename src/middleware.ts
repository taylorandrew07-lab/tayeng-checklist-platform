import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  // Allow all auth pages through
  const pathname = request.nextUrl.pathname
  if (pathname.startsWith('/login') || pathname.startsWith('/signup') ||
      pathname.startsWith('/forgot-password') || pathname.startsWith('/reset-password') ||
      pathname.startsWith('/auth')) {
    return NextResponse.next()
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
