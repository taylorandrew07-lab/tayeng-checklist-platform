'use client'

import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { dirtyState } from '@/lib/dirty-state'
import type { Profile } from '@/lib/types/database'
import {
  LayoutDashboard,
  FileText,
  Briefcase,
  Users,
  Building2,
  ClipboardList,
  LogOut,
  ChevronRight,
  X,
  Settings,
  Calculator,
} from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
}

const adminNav: NavItem[] = [
  { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
  { label: 'Templates', href: '/admin/templates', icon: FileText },
  { label: 'Jobs', href: '/admin/jobs', icon: Briefcase },
  { label: 'Users', href: '/admin/users', icon: Users },
  { label: 'Clients', href: '/admin/clients', icon: Building2 },
  { label: 'Tools', href: '/admin/tools/interpolation', icon: Calculator },
]

const superAdminNav: NavItem[] = [
  { label: 'Settings', href: '/admin/settings', icon: Settings },
]

const surveyorNav: NavItem[] = [
  { label: 'Dashboard', href: '/surveyor', icon: LayoutDashboard },
  { label: 'My Jobs', href: '/surveyor/jobs', icon: Briefcase },
  { label: 'Tools', href: '/surveyor/tools/interpolation', icon: Calculator },
]

const clientNav: NavItem[] = [
  { label: 'My Jobs', href: '/client', icon: ClipboardList },
]

interface SidebarProps {
  profile: Profile & { is_super_admin?: boolean }
  open?: boolean
  onClose?: () => void
  pendingCount?: number
}

export default function Sidebar({ profile, open = true, onClose, pendingCount = 0 }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()

  const nav =
    profile.role === 'admin'
      ? adminNav
      : profile.role === 'surveyor'
      ? surveyorNav
      : clientNav

  function handleNavClick(href: string) {
    onClose?.()
    if (!dirtyState.requestNavigate(href)) return // handler shows dialog; dialog calls router.push
    router.push(href)
  }

  async function handleSignOut() {
    // Check dirty state before signing out
    if (dirtyState.isDirty) {
      if (!window.confirm('You have unsaved changes. Sign out anyway?')) return
    }
    const supabase = createClient()
    // Supabase clears its own persisted session (cookies) on signOut
    await supabase.auth.signOut()
    dirtyState.set(false)
    dirtyState.setHandler(null)
    router.push('/login')
    router.refresh()
  }

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 w-64 bg-brand-900 flex flex-col transition-transform duration-300',
          'lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-brand-800">
          <div className="flex items-center gap-2.5">
            <img src="/logo-full.jpeg" alt="Taylor Engineering Agencies Limited" className="h-10 w-auto rounded-md" />
          </div>
          {onClose && (
            <button onClick={onClose} className="lg:hidden text-brand-400 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Role badge */}
        <div className="px-4 py-3 border-b border-brand-800">
          <p className="text-brand-400 text-xs uppercase tracking-wide font-medium">
            {profile.is_super_admin ? 'Super Admin' : profile.role === 'admin' ? 'Administrator' : profile.role === 'surveyor' ? 'Surveyor' : 'Client'}
          </p>
          <p className="text-white text-sm font-medium mt-0.5 truncate">{profile.full_name}</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {[...nav, ...(profile.is_super_admin ? superAdminNav : [])].map((item) => {
            const isActive =
              item.href === '/admin' || item.href === '/surveyor' || item.href === '/client'
                ? pathname === item.href
                : pathname.startsWith(item.href)
            return (
              <button
                key={item.href}
                onClick={() => handleNavClick(item.href)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group w-full text-left',
                  isActive
                    ? 'bg-brand-700 text-white'
                    : 'text-brand-300 hover:bg-brand-800 hover:text-white'
                )}
              >
                <item.icon className={cn('h-5 w-5 flex-shrink-0', isActive ? 'text-white' : 'text-brand-400 group-hover:text-white')} />
                {item.label}
                {item.href === '/admin/users' && pendingCount > 0 && (
                  <span className="ml-auto bg-yellow-400 text-yellow-900 text-xs font-bold px-1.5 py-0.5 rounded-full">
                    {pendingCount}
                  </span>
                )}
                {isActive && pendingCount === 0 && <ChevronRight className="h-4 w-4 ml-auto" />}
              </button>
            )
          })}
        </nav>

        {/* Sign out */}
        <div className="px-3 py-4 border-t border-brand-800">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-brand-300 hover:bg-brand-800 hover:text-white transition-colors w-full"
          >
            <LogOut className="h-5 w-5 text-brand-400" />
            Sign Out
          </button>
        </div>
      </aside>
    </>
  )
}
