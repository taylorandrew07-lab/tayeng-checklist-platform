'use client'

// Admin dashboard — the alerts that need you, and nothing else.
//
// The Recent Jobs list was removed deliberately (step 1 of the dashboard revamp): it
// was the 15 newest jobs by created_at, which is the Jobs page one click away with
// less filtering and no search. A dashboard that repeats the page next to it costs a
// query on every load and earns nothing. If you want jobs, go to Jobs.
//
// What belongs here instead is work that would otherwise be FORGOTTEN — a report whose
// window has elapsed, kit that's out of calibration. Both panels below self-gate to
// null, so this page shows only what is actually outstanding.

import Link from 'next/link'
import { Briefcase } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import ReportsDuePanel from '@/components/job/ReportsDuePanel'
import InventoryAlertsPanel from '@/components/inventory/InventoryAlertsPanel'

export default function AdminDashboard() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-rise">
      <PageHeader
        title="Dashboard"
        subtitle="What needs your attention"
        actions={
          <Link href="/admin/jobs/new" className="btn-primary text-sm">
            <Briefcase className="h-4 w-4" />New Job
          </Link>
        }
      />

      {/* Reports whose incubation/lag window has elapsed and can now be written up.
          Renders nothing unless you're the super-admin and something is actually due. */}
      <ReportsDuePanel />
      {/* Self-gating: renders nothing for non-admins and nothing when clear. */}
      <InventoryAlertsPanel />
    </div>
  )
}
