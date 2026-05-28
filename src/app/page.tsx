import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function HomePage() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    redirect('/admin')
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const role = profile?.role ?? 'surveyor'

  if (role === 'admin') redirect('/admin')
  if (role === 'surveyor') redirect('/surveyor')
  if (role === 'client') redirect('/client')

  redirect('/login')
}
