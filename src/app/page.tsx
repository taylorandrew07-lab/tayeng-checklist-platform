import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

const ROLE_HOME: Record<string, string> = {
  admin: '/admin',
  surveyor: '/surveyor',
  client: '/client',
  office: '/office',
}

// Resolve the destination on the SERVER from the session cookie, then redirect
// straight into the user's app. Previously this unconditionally redirected to
// /login, whose client then re-checked the session and bounced authenticated
// users back in — so every launch flashed the login card ("it logged me out").
// Now only genuinely-unauthenticated visitors ever see /login. Auth is still
// required (no session → /login) and RLS guards every row, so nothing is exposed.
export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  redirect(ROLE_HOME[profile?.role ?? ''] ?? '/surveyor')
}
