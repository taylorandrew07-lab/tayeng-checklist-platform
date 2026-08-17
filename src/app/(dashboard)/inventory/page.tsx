'use client'

// One cross-role page, gated by tab — the shape /competition uses.
//
// '/inventory' MUST stay in SHARED_ROUTES in (dashboard)/layout.tsx, or a
// surveyor opening it is bounced straight back to /surveyor.
//
// The tabs are a convenience, not a security boundary: RLS is. A surveyor who
// types the URL for a tab they cannot see still gets nothing back, because the
// ledger's SELECT policy only returns their own rows.

import { useEffect, useState } from 'react'
import { Boxes } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import { createClient } from '@/lib/supabase/client'
import { fetchMyOfficePermissions, OFFICE_PERMISSIONS } from '@/lib/office/permissions'
import ConsumablesList from '@/components/inventory/ConsumablesList'
import EquipmentList from '@/components/inventory/EquipmentList'
import MyActivity from '@/components/inventory/MyActivity'
import HistoryTable from '@/components/inventory/HistoryTable'
import LocationsManager from '@/components/inventory/LocationsManager'

// The two stock tabs ARE the catalogue: each owns adding, editing, archiving and
// deleting its own kind of item. There is deliberately no separate "Items" list —
// that showed the same rows a second time, and made "Consumables" look like a
// button you could click into when it was only an Add action.
type TabKey = 'consumables' | 'equipment' | 'mine' | 'history' | 'locations'

export default function InventoryPage() {
  const [tab, setTab] = useState<TabKey>('consumables')
  const [isAdmin, setIsAdmin] = useState(false)
  const [isStaff, setIsStaff] = useState(false)
  const [canSeeHistory, setCanSeeHistory] = useState(false)
  const [ready, setReady] = useState(false)
  // Bumped by an undo so the stock list refetches behind the tab.
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setReady(true); return }

      const { data: profile } = await supabase
        .from('profiles').select('role, is_super_admin').eq('id', user.id).maybeSingle()

      const admin = profile?.role === 'admin' || profile?.is_super_admin === true
      // Only admins and surveyors may record movements — is_active_staff() in SQL.
      const staff = admin || profile?.role === 'surveyor'
      setIsAdmin(admin)
      setIsStaff(staff)

      if (admin) {
        setCanSeeHistory(true)
      } else if (profile?.role === 'office') {
        const granted = await fetchMyOfficePermissions(supabase)
        setCanSeeHistory(granted.has(OFFICE_PERMISSIONS.INVENTORY_HISTORY_VIEW))
      }
      setReady(true)
    })()
  }, [])

  const tabs = [
    { key: 'consumables', label: 'Consumables' },
    { key: 'equipment', label: 'Equipment' },
    ...(isStaff ? [{ key: 'mine', label: 'My activity' }] : []),
    ...(canSeeHistory ? [{ key: 'history', label: 'History' }] : []),
    ...(isAdmin ? [{ key: 'locations', label: 'Locations' }] : []),
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-6 animate-rise">
      <PageHeader
        icon={Boxes}
        title="Inventory"
        subtitle="What we have, where it is, and when the equipment is due back for calibration."
      />

      <Tabs tabs={tabs} active={tab} onChange={k => setTab(k as TabKey)} />

      {!ready ? (
        <div className="space-y-3">
          <div className="skeleton h-12 w-full" />
          <div className="skeleton h-12 w-full" />
          <div className="skeleton h-12 w-full" />
        </div>
      ) : (
        <>
          {tab === 'consumables' && <ConsumablesList key={refresh} canEdit={isStaff} isAdmin={isAdmin} />}
          {tab === 'equipment' && <EquipmentList key={refresh} canEdit={isStaff} isAdmin={isAdmin} />}
          {tab === 'mine' && isStaff && <MyActivity onChanged={() => setRefresh(n => n + 1)} />}
          {tab === 'history' && canSeeHistory && <HistoryTable />}
          {tab === 'locations' && isAdmin && <LocationsManager />}
        </>
      )}
    </div>
  )
}
