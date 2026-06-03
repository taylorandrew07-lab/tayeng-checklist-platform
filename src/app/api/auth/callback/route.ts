import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const ROLE_REDIRECT: Record<string, string> = {
  admin: '/admin',
  surveyor: '/surveyor',
  client: '/client',
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // next param allows /forgot-password to send the user to /reset-password after code exchange
  const next = searchParams.get('next')

  if (code) {
    const supabase = await createClient()
    const { data: { session }, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && session) {
      // If caller specified a next page (e.g. /reset-password), honour it
      if (next) {
        return NextResponse.redirect(`${origin}${next}`)
      }

      // Otherwise route by role
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, is_active')
        .eq('id', session.user.id)
        .single()

      // Inactive users: sign out and send back to login with error
      if (!profile || !profile.is_active) {
        await supabase.auth.signOut()
        return NextResponse.redirect(`${origin}/login?error=pending`)
      }

      return NextResponse.redirect(`${origin}${ROLE_REDIRECT[profile.role] ?? '/login'}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
