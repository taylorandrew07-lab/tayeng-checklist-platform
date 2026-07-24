'use client'

import { useEffect, useMemo, useState } from 'react'
import { Trophy, Medal } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import { listWinners, withUrls, monthLabel } from '@/lib/competition/api'
import type { EntryWithUrl, Placement } from '@/lib/competition/types'
import { EntryThumb, EntryLightbox } from './media'

const PLACEMENT_ORDER: Record<Placement, number> = { winner: 0, runner_up: 1 }

export default function WinnersWall() {
  const [entries, setEntries] = useState<EntryWithUrl[]>([])
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<EntryWithUrl | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const rows = await listWinners()
      if (!alive) return
      setEntries(await withUrls(rows))
      setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  // Group by month (newest first), winner before runner-up within a month.
  const months = useMemo(() => {
    const map = new Map<string, EntryWithUrl[]>()
    for (const e of entries) {
      const arr = map.get(e.month) ?? []
      arr.push(e)
      map.set(e.month, arr)
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([month, list]) => ({
        month,
        list: list.sort((a, b) => PLACEMENT_ORDER[a.placement as Placement] - PLACEMENT_ORDER[b.placement as Placement]),
      }))
  }, [entries])

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="skeleton h-6 w-40 rounded" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3"><div className="skeleton aspect-square rounded-lg" /><div className="skeleton aspect-square rounded-lg" /></div>
      </div>
    )
  }

  if (!months.length) {
    return <EmptyState icon={Trophy} title="No winners yet" description="Once the admin picks a monthly winner, it’ll be celebrated here for everyone to see." />
  }

  return (
    <div className="space-y-8">
      {months.map(({ month, list }) => (
        <section key={month} className="space-y-3">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-brand-600" />
            <h2 className="section-title">{monthLabel(month)}</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {list.map(e => {
              const isWinner = e.placement === 'winner'
              return (
                <figure key={e.id} className="card overflow-hidden p-0">
                  <EntryThumb
                    entry={e}
                    onClick={() => setPreview(e)}
                    className="aspect-[4/3] rounded-none"
                    overlay={
                      <span className={[
                        'absolute left-2 top-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
                        isWinner ? 'bg-brand-600 text-white' : 'bg-white/90 text-gray-800',
                      ].join(' ')}>
                        {isWinner ? <Trophy className="h-3 w-3" /> : <Medal className="h-3 w-3" />}
                        {isWinner ? 'Winner' : 'Runner-up'}
                      </span>
                    }
                  />
                  <figcaption className="flex items-baseline justify-between gap-3 px-3 py-2.5">
                    <span className="truncate text-sm font-medium text-gray-900">{e.winner_name ?? '—'}</span>
                    {e.caption && <span className="truncate text-sm text-gray-500">{e.caption}</span>}
                  </figcaption>
                </figure>
              )
            })}
          </div>
        </section>
      ))}

      <EntryLightbox
        entry={preview}
        onClose={() => setPreview(null)}
        footer={preview && (
          <div className="space-y-0.5">
            <p className="font-medium">{preview.placement === 'winner' ? '🏆 Winner' : '🥈 Runner-up'} · {monthLabel(preview.month)}</p>
            <p className="text-white/80">{preview.winner_name}{preview.caption ? ` — ${preview.caption}` : ''}</p>
          </div>
        )}
      />
    </div>
  )
}
