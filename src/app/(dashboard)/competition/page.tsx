'use client'

import { useEffect, useState } from 'react'
import { Camera } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import { createClient } from '@/lib/supabase/client'
import MyPhotos from '@/components/competition/MyPhotos'
import WinnersWall from '@/components/competition/WinnersWall'
import Judging from '@/components/competition/Judging'

type TabKey = 'mine' | 'winners' | 'judging'

export default function CompetitionPage() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [tab, setTab] = useState<TabKey>('mine')

  useEffect(() => {
    ;(async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.from('profiles').select('role, is_super_admin').eq('id', user.id).single()
      setIsAdmin(data?.role === 'admin' || data?.is_super_admin === true)
    })()
  }, [])

  const tabs = [
    { key: 'mine', label: 'My Photos' },
    { key: 'winners', label: 'Winners' },
    ...(isAdmin ? [{ key: 'judging', label: 'Judging' }] : []),
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        icon={Camera}
        title="Photo Competition"
        subtitle="Share your best shots from the field. A winner and runner-up are chosen each month."
      />
      <Tabs tabs={tabs} active={tab} onChange={k => setTab(k as TabKey)} />
      {tab === 'mine' && <MyPhotos />}
      {tab === 'winners' && <WinnersWall />}
      {tab === 'judging' && isAdmin && <Judging />}
    </div>
  )
}
