'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Users, Building2, ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const TABS = [
  { key: 'team', label: 'Team', href: '/admin/users', icon: Users },
  { key: 'clients', label: 'Clients', href: '/admin/clients', icon: Building2 },
  { key: 'approvals', label: 'Approvals', href: '/admin/profile-requests', icon: ShieldCheck },
] as const

/** Shared sub-nav for the People hub (Users / Clients / Approvals). Each tab
 *  shows a yellow count when something is waiting there: Team = pending signups
 *  + client requests; Approvals = profile change requests. */
export default function PeopleTabs() {
  const pathname = usePathname()
  const [counts, setCounts] = useState<{ team: number; approvals: number }>({ team: 0, approvals: 0 })

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false
    ;(async () => {
      const [u, c, p] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', false),
        supabase.from('client_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('profile_change_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      ])
      if (!cancelled) setCounts({ team: (u.count ?? 0) + (c.count ?? 0), approvals: p.count ?? 0 })
    })()
    return () => { cancelled = true }
  }, [pathname])

  return (
    <div className="flex items-center gap-1 border-b border-gray-200">
      {TABS.map(t => {
        const active = pathname.startsWith(t.href)
        const n = t.key === 'team' ? counts.team : t.key === 'approvals' ? counts.approvals : 0
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex items-center gap-2 px-3.5 py-2 text-sm font-medium border-b-2 -mb-px rounded-t-md transition-colors whitespace-nowrap ${active ? 'border-brand-600 text-brand-700 bg-brand-50/60' : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'}`}
          >
            <t.icon className="h-4 w-4" />{t.label}
            {n > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-yellow-400 text-yellow-900 text-[11px] font-bold leading-none">
                {n}
              </span>
            )}
          </Link>
        )
      })}
    </div>
  )
}
