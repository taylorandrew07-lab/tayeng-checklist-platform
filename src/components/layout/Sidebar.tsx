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
  Receipt, Ship, FolderOpen, Mail, CalendarDays, IdCard, BarChart3, Anchor, Building2,
} from 'lucide-react'

export interface NavItem {
  label: string
  href: string
  icon: React.ElementType
}

// The nav is organised into labelled groups (Operations / People …) so the app
// reads as one structured product instead of a flat pile of links. A section with
// no title is an unlabelled group (the landing item, utilities) separated only by
// a divider.
interface NavSection {
  title?: string
  items: NavItem[]
}

const adminNav: NavSection[] = [
  { items: [{ label: 'Home', href: '/admin', icon: LayoutDashboard }] },
  { title: 'Operations', items: [
    { label: 'Jobs', href: '/admin/jobs', icon: Briefcase },
    { label: 'Cargo', href: '/admin/cargo', icon: Ship },
    { label: 'Vessels', href: '/admin/vessels', icon: Anchor },
    { label: 'Templates', href: '/admin/templates', icon: FileText },
  ] },
  { title: 'Finance & clients', items: [
    { label: 'Finance', href: '/admin/invoicing', icon: Receipt },
    { label: 'Clients', href: '/admin/clients', icon: Building2 },
    { label: 'Insights', href: '/admin/analytics', icon: BarChart3 },
  ] },
  { title: 'People', items: [
    { label: 'Team', href: '/admin/users', icon: Users },
    { label: 'Credentials', href: '/personnel', icon: IdCard },
  ] },
  { items: [
    { label: 'Tools', href: '/admin/tools/interpolation', icon: Calculator },
    { label: 'Calendar', href: '/calendar', icon: CalendarDays },
    { label: 'Inbox', href: '/inbox', icon: Mail },
  ] },
]

const surveyorNav: NavSection[] = [
  { items: [{ label: 'Home', href: '/surveyor', icon: LayoutDashboard }] },
  { title: 'Operations', items: [
    { label: 'Cargo', href: '/surveyor/cargo', icon: Ship },
    { label: 'Vessel Documents', href: '/surveyor/documents', icon: FolderOpen },
  ] },
  { items: [
    { label: 'Profile', href: '/profile', icon: IdCard },
    { label: 'Tools', href: '/surveyor/tools/interpolation', icon: Calculator },
    { label: 'Calendar', href: '/calendar', icon: CalendarDays },
    { label: 'Inbox', href: '/inbox', icon: Mail },
  ] },
]

const clientNav: NavSection[] = [
  { items: [
    { label: 'Home', href: '/client', icon: ClipboardList },
    { label: 'Cargo', href: '/client/cargo', icon: Ship },
    { label: 'Inbox', href: '/inbox', icon: Mail },
  ] },
]

// Office nav is permission-built: Home + Jobs are always present; the rest appear
// per granted permission, grouped to match the admin structure.
function officeNav(officePermissions: string[]): NavSection[] {
  const granted = new Set(officePermissions)
  const ops: NavItem[] = [{ label: 'Jobs', href: '/office/jobs', icon: Briefcase }]
  if (granted.has(OFFICE_PERMISSIONS.CARGO_VIEW)) ops.push({ label: 'Cargo', href: '/office/cargo', icon: Ship })

  const sections: NavSection[] = [
    { items: [{ label: 'Home', href: '/office', icon: LayoutDashboard }] },
    { title: 'Operations', items: ops },
  ]
  if (granted.has(OFFICE_PERMISSIONS.INVOICING_VIEW) || granted.has(OFFICE_PERMISSIONS.INVOICING_MANAGE)) {
    sections.push({ title: 'Finance', items: [{ label: 'Finance', href: '/office/invoicing', icon: Receipt }] })
  }
  if (granted.has(OFFICE_PERMISSIONS.PERSONAL_DOCS_VIEW)) {
    sections.push({ title: 'People', items: [{ label: 'Credentials', href: '/personnel', icon: IdCard }] })
  }
  const utils: NavItem[] = []
  if (granted.has(OFFICE_PERMISSIONS.CALENDAR_VIEW)) utils.push({ label: 'Calendar', href: '/calendar', icon: CalendarDays })
  utils.push({ label: 'Inbox', href: '/inbox', icon: Mail })
  sections.push({ items: utils })
  return sections
}

function roleNav(role: string, officePermissions: string[]): NavSection[] {
  if (role === 'admin') return adminNav
  if (role === 'surveyor') return surveyorNav
  if (role === 'office') return officeNav(officePermissions)
  return clientNav
}

interface SidebarProps {
  profile: Profile & { is_super_admin?: boolean }
  open?: boolean
  onClose?: () => void
  pendingCount?: number
  /** Unread message count; badges the Inbox nav item. */
  unreadMessages?: number
  /** Billing-reconciliation flag count; badges the Finance nav item. */
  reconcileCount?: number
  /** Granted office permission keys; drives which office nav items appear. */
  officePermissions?: string[]
}

export default function Sidebar({ profile, open = true, onClose, pendingCount = 0, unreadMessages = 0, reconcileCount = 0, officePermissions = [] }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()

  const sections = roleNav(profile.role, officePermissions)
  // Settings is a fixed, super-admin-only item pinned after the nav groups.
  const settingsSection: NavSection | null = profile.is_super_admin
    ? { items: [{ label: 'Settings', href: '/admin/settings', icon: Settings }] }
    : null

  function handleNavClick(href: string) {
    onClose?.()
    if (!dirtyState.requestNavigate(href)) return // handler shows dialog; dialog calls router.push
    router.push(href)
  }

  function badgeFor(href: string): number {
    if (href === '/admin/users') return pendingCount
    if (href === '/inbox') return unreadMessages
    if (href === '/admin/invoicing' || href === '/office/invoicing') return reconcileCount
    return 0
  }

  function renderItem(item: NavItem) {
    const isRoot = item.href === '/admin' || item.href === '/surveyor' || item.href === '/client' || item.href === '/office'
    const isActive = isRoot ? pathname === item.href : pathname.startsWith(item.href)
    const badge = badgeFor(item.href)
    return (
      <button
        key={item.href}
        onClick={() => handleNavClick(item.href)}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group w-full text-left',
          isActive ? 'bg-brand-700 text-white' : 'text-brand-300 hover:bg-brand-800 hover:text-white',
        )}
      >
        <item.icon className={cn('h-5 w-5 flex-shrink-0', isActive ? 'text-white' : 'text-brand-400 group-hover:text-white')} />
        {item.label}
        {badge > 0
          ? <span className="ml-auto bg-yellow-400 text-yellow-900 text-xs font-bold px-1.5 py-0.5 rounded-full">{badge}</span>
          : isActive ? <ChevronRight className="h-4 w-4 ml-auto" /> : null}
      </button>
    )
  }

  function renderSection(section: NavSection, withDivider: boolean, key: string) {
    return (
      <div key={key} className={withDivider ? 'mt-3 pt-3 border-t border-brand-800/70' : ''}>
        {section.title && (
          <p className="px-3 pb-1 text-[10px] uppercase tracking-wider font-semibold text-brand-400/80">{section.title}</p>
        )}
        <div className="space-y-1">{section.items.map(renderItem)}</div>
      </div>
    )
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

  const allSections = settingsSection ? [...sections, settingsSection] : sections

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={onClose} aria-hidden="true" />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 w-64 bg-brand-900 flex flex-col transition-transform duration-300',
          'lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
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
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          {allSections.map((section, i) => renderSection(section, i > 0, `sec-${i}`))}
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
