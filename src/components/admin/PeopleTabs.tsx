'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Users, IdCard, ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const TABS = [
  { key: 'team', label: 'Team', href: '/admin/users', icon: Users },
  { key: 'credentials', label: 'Credentials', href: '/personnel', icon: IdCard },
  { key: 'approvals', label: 'Approvals', href: '/admin/profile-requests', icon: ShieldCheck },
] as const

/** Shared sub-nav for the Team hub (Team / Credentials / Approvals). Admin-only —
 *  renders nothing for other roles (e.g. office staff who can also reach
 *  /personnel). Yellow count: Team = pending signups + client requests; Approvals
 *  = profile change requests. */
export default function PeopleTabs() {
  const pathname = usePathname()
  const [isAdmin, setIsAdmin] = useState(false)
  const [counts, setCounts] = useState<{ team: number; approvals: number }>({ team: 0, approvals: 0 })

  useEffect(() => {
    // Role from the layout's cached profile — instant, no fetch/flash.
    let admin = false
    try { admin = JSON.parse(localStorage.getItem('te_profile') ?? 'null')?.role === 'admin' } catch { /* ignore */ }
    setIsAdmin(admin)
    if (!admin) return

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

  if (!isAdmin) return null

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
