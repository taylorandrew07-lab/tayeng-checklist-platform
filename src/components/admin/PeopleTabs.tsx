'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Users, Building2, ShieldCheck } from 'lucide-react'

const TABS = [
  { label: 'Team', href: '/admin/users', icon: Users },
  { label: 'Clients', href: '/admin/clients', icon: Building2 },
  { label: 'Approvals', href: '/admin/profile-requests', icon: ShieldCheck },
]

/** Shared sub-nav for the People hub (Users / Clients / Approvals), so these
 *  three related pages share one sidebar entry. */
export default function PeopleTabs() {
  const pathname = usePathname()
  return (
    <div className="flex items-center gap-1 border-b border-gray-200">
      {TABS.map(t => {
        const active = pathname.startsWith(t.href)
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${active ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <t.icon className="h-4 w-4" />{t.label}
          </Link>
        )
      })}
    </div>
  )
}
