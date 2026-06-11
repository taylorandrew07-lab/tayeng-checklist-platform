'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Lock } from 'lucide-react'
import { fetchMyOfficePermissions, OFFICE_PERMISSIONS } from '@/lib/office/permissions'
import CalendarView from '@/components/calendar/CalendarView'

export default function CalendarPage() {
  const [state, setState] = useState<{ allowed: boolean; isAdmin: boolean; canRequestLeave: boolean } | null>(null)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: p } = await supabase.from('profiles').select('role, is_super_admin').eq('id', user.id).single()
      const role = p?.role
      const isAdmin = role === 'admin' || p?.is_super_admin === true
      if (role === 'admin' || role === 'surveyor') {
        setState({ allowed: true, isAdmin, canRequestLeave: true })
      } else if (role === 'office') {
        const granted = await fetchMyOfficePermissions(supabase)
        setState({ allowed: granted.has(OFFICE_PERMISSIONS.CALENDAR_VIEW), isAdmin: false, canRequestLeave: false })
      } else {
        setState({ allowed: false, isAdmin: false, canRequestLeave: false })
      }
    }
    load()
  }, [])

  if (!state) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
  if (!state.allowed) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <Lock className="h-10 w-10 text-gray-300 mx-auto mb-3" />
        <h1 className="page-title mb-2">No access</h1>
        <p className="text-gray-500">You don&apos;t have access to the calendar. Ask an administrator if you need it.</p>
      </div>
    )
  }
  return <CalendarView isAdmin={state.isAdmin} canRequestLeave={state.canRequestLeave} />
}
