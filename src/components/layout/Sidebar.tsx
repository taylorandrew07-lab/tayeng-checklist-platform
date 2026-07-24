'use client'

import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { dirtyState } from '@/lib/dirty-state'
import type { Profile } from '@/lib/types/database'
import { OFFICE_PERMISSIONS } from '@/lib/office/permissions'
import { confirmDialog } from '@/components/ui/confirm'
import {
  LayoutDashboard, FileText, Briefcase, Users, ClipboardList,
  LogOut, ChevronRight, X, Settings, Calculator,
  Receipt, Ship, FolderOpen, Mail, CalendarDays, IdCard, Building2, Camera,
} from 'lucide-react'

export interface NavItem {
  label: string
  href: string
  icon: React.ElementType
}

const adminNav: NavItem[] = [
  { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
  { label: 'Jobs', href: '/admin/jobs', icon: Briefcase },
  { label: 'Finance', href: '/admin/invoicing', icon: Receipt },
  { label: 'Clients', href: '/admin/clients', icon: Building2 },
  // Team is a hub: the page itself has tabs for Team / Credentials / Approvals.
  { label: 'Team', href: '/admin/users', icon: Users },
  { label: 'Templates', href: '/admin/templates', icon: FileText },
  { label: 'Cargo Monitoring', href: '/admin/cargo', icon: Ship },
  { label: 'Photo Competition', href: '/competition', icon: Camera },
  { label: 'Tools', href: '/admin/tools/interpolation', icon: Calculator },
  { label: 'Calendar', href: '/calendar', icon: CalendarDays },
  { label: 'Inbox', href: '/inbox', icon: Mail },
]

// Settings is pinned to the bottom and is never reorderable.
const superAdminNav: NavItem[] = [
  { label: 'Settings', href: '/admin/settings', icon: Settings },
]

const surveyorNav: NavItem[] = [
  { label: 'Dashboard', href: '/surveyor', icon: LayoutDashboard },
  { label: 'Cargo Monitoring', href: '/surveyor/cargo', icon: Ship },
  { label: 'Vessel Documents', href: '/surveyor/documents', icon: FolderOpen },
  { label: 'Photo Competition', href: '/competition', icon: Camera },
  { label: 'Profile', href: '/profile', icon: FileText },
  { label: 'Calendar', href: '/calendar', icon: CalendarDays },
  { label: 'Inbox', href: '/inbox', icon: Mail },
  { label: 'Tools', href: '/surveyor/tools/interpolation', icon: Calculator },
]

const clientNav: NavItem[] = [
  { label: 'Dashboard', href: '/client', icon: ClipboardList },
  { label: 'Cargo Monitoring', href: '/client/cargo', icon: Ship },
  { label: 'Inbox', href: '/inbox', icon: Mail },
]

// Office nav. Home + Jobs are always present; Finance is added only when the user
// holds an invoicing permission (see officeNav()).
const officeBaseNav: NavItem[] = [
  { label: 'Dashboard', href: '/office', icon: LayoutDashboard },
  { label: 'Jobs', href: '/office/jobs', icon: Briefcase },
  { label: 'Photo Competition', href: '/competition', icon: Camera },
  { label: 'Inbox', href: '/inbox', icon: Mail },
]

function officeNav(officePermissions: string[]): NavItem[] {
  const nav = [...officeBaseNav]
  const granted = new Set(officePermissions)
  if (granted.has(OFFICE_PERMISSIONS.PERSONAL_DOCS_VIEW)) {
    nav.push({ label: 'Credentials', href: '/personnel', icon: IdCard })
  }
  if (granted.has(OFFICE_PERMISSIONS.CALENDAR_VIEW)) {
    nav.push({ label: 'Calendar', href: '/calendar', icon: CalendarDays })
  }
  if (granted.has(OFFICE_PERMISSIONS.INVOICING_VIEW) || granted.has(OFFICE_PERMISSIONS.INVOICING_MANAGE)) {
    nav.push({ label: 'Finance', href: '/office/invoicing', icon: Receipt })
  }
  if (granted.has(OFFICE_PERMISSIONS.CARGO_VIEW)) {
    nav.push({ label: 'Cargo Monitoring', href: '/office/cargo', icon: Ship })
  }
  return nav
}

function roleNav(role: string, officePermissions: string[]): NavItem[] {
  if (role === 'admin') return adminNav
  if (role === 'surveyor') return surveyorNav
  if (role === 'office') return officeNav(officePermissions)
  return clientNav
}

// Apply a saved order; keep unknown saved entries out, append new canonical
// items at the end so adding a nav item later never hides it.
function orderedNav(canonical: NavItem[], savedOrder?: string[]): NavItem[] {
  if (!savedOrder?.length) return canonical
  const byHref = new Map(canonical.map(i => [i.href, i]))
  const result: NavItem[] = []
  for (const href of savedOrder) {
    const item = byHref.get(href)
    if (item) { result.push(item); byHref.delete(href) }
  }
  for (const item of canonical) if (byHref.has(item.href)) result.push(item)
  return result
}

interface SidebarProps {
  profile: Profile & { is_super_admin?: boolean }
  open?: boolean
  onClose?: () => void
  pendingCount?: number
  /** Unread message count; badges the Inbox nav item. */
  unreadMessages?: number
  /** Billing-reconciliation flag count; badges the Invoicing nav item. */
  reconcileCount?: number
  /** Granted office permission keys; drives which office nav items appear. */
  officePermissions?: string[]
}

export default function Sidebar({ profile, open = true, onClose, pendingCount = 0, unreadMessages = 0, reconcileCount = 0, officePermissions = [] }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()

  // Honour any nav order a user saved under the old "Customize menu" feature,
  // but the reorder UI itself is gone — the canonical order is fixed now.
  const order = orderedNav(roleNav(profile.role, officePermissions), profile.ui_prefs?.nav_order)

  function handleNavClick(href: string) {
    onClose?.()
    if (!dirtyState.requestNavigate(href)) return // handler shows dialog; dialog calls router.push
    router.push(href)
  }

  async function handleSignOut() {
    if (dirtyState.isDirty) {
      if (!(await confirmDialog({ title: 'Unsaved changes', message: 'You have unsaved changes. Sign out anyway?', danger: true, confirmLabel: 'Sign out' }))) return
    } else if (!(await confirmDialog({ title: 'Sign out', message: 'Log out of Taylor Engineering?', confirmLabel: 'Sign out' }))) {
      return
    }
    const supabase = createClient()
    await supabase.auth.signOut()

    // Wipe device-local state so nothing usable is left behind on a shared device:
    // cached profile + session flags, offline IndexedDB stores, SW caches.
    try {
      ;['te_profile', 'te_last_email', 'te_remember', 'te_last_activity'].forEach(k => localStorage.removeItem(k))
    } catch { /* storage unavailable */ }
    try {
      if (typeof indexedDB !== 'undefined') { indexedDB.deleteDatabase('tayeng-offline'); indexedDB.deleteDatabase('tayeng-cargo') }
    } catch { /* ignore */ }
    try {
      if (typeof caches !== 'undefined') { for (const k of await caches.keys()) await caches.delete(k) }
      const regs = await navigator.serviceWorker?.getRegistrations?.()
      if (regs) for (const r of regs) await r.unregister()
    } catch { /* ignore */ }

    dirtyState.set(false)
    dirtyState.setHandler(null)
    router.push('/login')
    router.refresh()
  }

  const settingsItem = profile.is_super_admin ? superAdminNav : []

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={onClose} aria-hidden="true" />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 w-64 bg-brand-900 flex flex-col transition-transform duration-300',
          'lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Header / logo */}
        <div className="relative px-3 pt-4 pb-3 border-b border-brand-800">
          <img src="/logo-full.png" alt="Taylor Engineering Agencies Limited" className="w-full h-auto" />
          {onClose && (
            <button onClick={onClose} className="lg:hidden absolute top-2 right-2 text-brand-400 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Role badge */}
        <div className="px-4 py-3 border-b border-brand-800">
          <p className="text-brand-400 text-xs uppercase tracking-wide font-medium">
            {profile.is_super_admin ? 'Super Admin' : profile.role === 'admin' ? 'Administrator' : profile.role === 'surveyor' ? 'Surveyor' : profile.role === 'office' ? 'Office' : 'Client'}
          </p>
          <p className="text-white text-sm font-medium mt-0.5 truncate">{profile.full_name}</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {[...order, ...settingsItem].map((item) => {
            const isActive =
              item.href === '/admin' || item.href === '/surveyor' || item.href === '/client' || item.href === '/office'
                ? pathname === item.href
                : pathname.startsWith(item.href)
            return (
              <button
                key={item.href}
                onClick={() => handleNavClick(item.href)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group w-full text-left',
                  isActive ? 'bg-brand-700 text-white' : 'text-brand-300 hover:bg-brand-800 hover:text-white'
                )}
              >
                <item.icon className={cn('h-5 w-5 flex-shrink-0', isActive ? 'text-white' : 'text-brand-400 group-hover:text-white')} />
                {item.label}
                {item.href === '/admin/users' && pendingCount > 0 ? (
                  <span className="ml-auto bg-yellow-400 text-yellow-900 text-xs font-bold px-1.5 py-0.5 rounded-full">
                    {pendingCount}
                  </span>
                ) : item.href === '/inbox' && unreadMessages > 0 ? (
                  <span className="ml-auto bg-yellow-400 text-yellow-900 text-xs font-bold px-1.5 py-0.5 rounded-full">
                    {unreadMessages}
                  </span>
                ) : item.href === '/admin/invoicing' && reconcileCount > 0 ? (
                  <span className="ml-auto bg-yellow-400 text-yellow-900 text-xs font-bold px-1.5 py-0.5 rounded-full">
                    {reconcileCount}
                  </span>
                ) : isActive ? <ChevronRight className="h-4 w-4 ml-auto" /> : null}
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
