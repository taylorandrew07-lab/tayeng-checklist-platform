import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  // Verify the caller is an admin
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { email, password, full_name, role, phone } = await request.json()

  if (!email || !password || !full_name || !role) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const serviceClient = createServiceClient()

  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role },
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // Update profile with phone if provided
  if (data.user && phone) {
    await serviceClient
      .from('profiles')
      .update({ phone })
      .eq('id', data.user.id)
  }

  return NextResponse.json({ user_id: data.user?.id }, { status: 201 })
}
