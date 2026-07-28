import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

const ROLE_REDIRECT: Record<string, string> = {
  admin: '/admin',
  surveyor: '/surveyor',
  client: '/client',
  office: '/office',
}

// Only these internal paths may be used as a post-auth `next` redirect target.
const ALLOWED_NEXT = ['/reset-password']

const VALID_OTP_TYPES: EmailOtpType[] = ['recovery', 'signup', 'invite', 'email_change', 'magiclink', 'email']

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const otpType = searchParams.get('type')
  // next param allows /forgot-password to send the user to /reset-password after code exchange
  const next = searchParams.get('next')

  const fail = (reason: string) => NextResponse.redirect(`${origin}/login?error=${reason}`)

  // Supabase reports link failures (expired, already used) as a URL *fragment*, which
  // the browser never sends to the server — the login page reads those client-side.
  // Some flows do use query params, so honour them when present.
  const urlError = searchParams.get('error_code') || searchParams.get('error')
  if (urlError && !code && !tokenHash) return fail(urlError)

  const supabase = await createClient()

  // Two link shapes are supported:
  //  - ?code=…       PKCE. Requires the code_verifier cookie written by the browser
  //                  that STARTED the request, so it cannot work cross-browser.
  //  - ?token_hash=… Verifier-free, so it survives being opened from a mail app's
  //                  in-app webview or a different browser entirely.
  let exchangeFailed: 'verifier_missing' | 'exchange_failed' | null = null

  if (tokenHash && otpType && (VALID_OTP_TYPES as string[]).includes(otpType)) {
    const { error } = await supabase.auth.verifyOtp({ type: otpType as EmailOtpType, token_hash: tokenHash })
    if (error) exchangeFailed = 'exchange_failed'
  } else if (code) {
    // If the verifier cookie is absent the link was opened somewhere other than the
    // browser that requested it — a distinct, very common failure (tapping the link
    // inside the Outlook/Gmail app) that deserves its own instruction rather than a
    // generic "authentication failed".
    const hasVerifier = request.headers.get('cookie')?.includes('-code-verifier') ?? false
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) exchangeFailed = hasVerifier ? 'exchange_failed' : 'verifier_missing'
  } else {
    return fail('auth_callback_failed')
  }

  if (exchangeFailed) return fail(exchangeFailed)

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return fail('auth_callback_failed')

  // If caller specified an allowlisted next page (e.g. /reset-password), honour it
  if (next && ALLOWED_NEXT.includes(next)) {
    return NextResponse.redirect(`${origin}${next}`)
  }

  // Otherwise route by role
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', session.user.id)
    .single()

  // A missing profile and a deactivated account are different problems and must not
  // share a message: "pending approval" is a lie to someone whose profile row was
  // deleted, and they would wait forever for an approval that can never arrive.
  if (profileErr || !profile) {
    await supabase.auth.signOut()
    return fail('no_profile')
  }
  if (!profile.is_active) {
    await supabase.auth.signOut()
    return fail('pending')
  }

  return NextResponse.redirect(`${origin}${ROLE_REDIRECT[profile.role] ?? '/login'}`)
}
