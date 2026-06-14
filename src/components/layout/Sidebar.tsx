'use client'

import { useState, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { dirtyState } from '@/lib/dirty-state'
import type { Profile } from '@/lib/types/database'
import { OFFICE_PERMISSIONS } from '@/lib/office/permissions'
import { confirmDialog } from '@/components/ui/confirm'
import {
  LayoutDashboard, FileText, Briefcase, Users, ClipboardList,
  LogOut, ChevronRight, X, Settings, Calculator, GripVertical, SlidersHorizontal, Check,
  Receipt, Ship, FolderOpen, Mail, CalendarDays, IdCard, BarChart3, Anchor,
} from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
}

const adminNav: NavItem[] = [
  { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
  { label: 'Jobs', href: '/admin/jobs', icon: Briefcase },
  { label: 'Insights', href: '/admin/analytics', icon: BarChart3 },
  { label: 'Finance', href: '/admin/invoicing', icon: Receipt },
  { label: 'Templates', href: '/admin/templates', icon: FileText },
  { label: 'Cargo Operations', href: '/admin/cargo', icon: Ship },
  { label: 'Vessels', href: '/admin/vessels', icon: Anchor },
  { label: 'Vessel Documents', href: '/admin/documents', icon: FolderOpen },
  { label: 'Tools', href: '/admin/tools/interpolation', icon: Calculator },
  // Users is a hub: the page itself has tabs for Team / Clients / Approvals.
  { label: 'Users', href: '/admin/users', icon: Users },
  { label: 'Personnel', href: '/personnel', icon: IdCard },
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
  { label: 'My Documents', href: '/profile', icon: FileText },
  { label: 'Calendar', href: '/calendar', icon: CalendarDays },
  { label: 'Inbox', href: '/inbox', icon: Mail },
  { label: 'Tools', href: '/surveyor/tools/interpolation', icon: Calculator },
]

const clientNav: NavItem[] = [
  { label: 'My Jobs', href: '/client', icon: ClipboardList },
  { label: 'Cargo Reports', href: '/client/cargo', icon: Ship },
  { label: 'Inbox', href: '/inbox', icon: Mail },
]

// Office nav. Dashboard + Jobs Monitor are always present; Invoicing is added
// only when the user holds an invoicing permission (see officeNav()).
const officeBaseNav: NavItem[] = [
  { label: 'Dashboard', href: '/office', icon: LayoutDashboard },
  { label: 'Jobs Monitor', href: '/office/jobs', icon: Briefcase },
  { label: 'Inbox', href: '/inbox', icon: Mail },
]

function officeNav(officePermissions: string[]): NavItem[] {
  const nav = [...officeBaseNav]
  const granted = new Set(officePermissions)
  if (granted.has(OFFICE_PERMISSIONS.PERSONAL_DOCS_VIEW)) {
    nav.push({ label: 'Personnel', href: '/personnel', icon: IdCard })
  }
  if (granted.has(OFFICE_PERMISSIONS.CALENDAR_VIEW)) {
    nav.push({ label: 'Calendar', href: '/calendar', icon: CalendarDays })
  }
  if (granted.has(OFFICE_PERMISSIONS.INVOICING_VIEW) || granted.has(OFFICE_PERMISSIONS.INVOICING_MANAGE)) {
    nav.push({ label: 'Invoicing', href: '/office/invoicing', icon: Receipt })
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

  const canonical = roleNav(profile.role, officePermissions)
  const [order, setOrder] = useState<NavItem[]>(() => orderedNav(canonical, profile.ui_prefs?.nav_order))
  const [editMode, setEditMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const savedRef = useRef<NavItem[]>(order)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleNavClick(href: string) {
    onClose?.()
    if (!dirtyState.requestNavigate(href)) return // handler shows dialog; dialog calls router.push
    router.push(href)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setOrder(prev => {
      const oldIndex = prev.findIndex(i => i.href === active.id)
      const newIndex = prev.findIndex(i => i.href === over.id)
      return arrayMove(prev, oldIndex, newIndex)
    })
  }

  async function saveOrder() {
    setSaving(true)
    try {
      const supabase = createClient()
      const nav_order = order.map(i => i.href)
      const ui_prefs = { ...(profile.ui_prefs ?? {}), nav_order }
      const { error } = await supabase.from('profiles').update({ ui_prefs }).eq('id', profile.id)
      if (error) throw error
      savedRef.current = order
      setEditMode(false)
    } catch {
      // Keep edit mode open on failure (e.g. migration not yet applied).
    } finally {
      setSaving(false)
    }
  }

  function cancelEdit() {
    setOrder(savedRef.current)
    setEditMode(false)
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
          {editMode ? (
            <>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={order.map(i => i.href)} strategy={verticalListSortingStrategy}>
                  {order.map(item => <SortableNavItem key={item.href} item={item} />)}
                </SortableContext>
              </DndContext>
              {settingsItem.map(item => (
                <div key={item.href} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-brand-400 opacity-60">
                  <span className="w-4" />
                  <item.icon className="h-5 w-5 flex-shrink-0" />
                  {item.label}
                  <span className="ml-auto text-[10px] uppercase tracking-wide">Fixed</span>
                </div>
              ))}
            </>
          ) : (
            [...order, ...settingsItem].map((item) => {
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
            })
          )}

          {/* Customize controls (only when there's more than one item to order) */}
          {order.length > 1 && (
            <div className="pt-2">
              {editMode ? (
                <div className="flex gap-2">
                  <button
                    onClick={saveOrder}
                    disabled={saving}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-brand-600 text-white hover:bg-brand-500 transition-colors"
                  >
                    <Check className="h-3.5 w-3.5" />{saving ? 'Saving…' : 'Done'}
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="px-3 py-2 rounded-lg text-xs font-medium text-brand-300 hover:bg-brand-800 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setEditMode(true)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-brand-400 hover:bg-brand-800 hover:text-white transition-colors w-full"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />Customize menu
                </button>
              )}
            </div>
          )}
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

function SortableNavItem({ item }: { item: NavItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.href })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-brand-100 bg-brand-800/70 cursor-grab touch-none select-none"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-4 w-4 text-brand-400 flex-shrink-0" />
      <item.icon className="h-5 w-5 flex-shrink-0 text-brand-300" />
      {item.label}
    </div>
  )
}
