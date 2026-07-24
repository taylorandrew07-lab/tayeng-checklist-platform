'use client'

import { useEffect, useMemo, useState } from 'react'
import { Users, ArrowLeft, ImageOff, User } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import { adminListStaffRoster, adminStaffEntries, monthLabel, type StaffRosterEntry } from '@/lib/competition/api'
import type { EntryWithUrl } from '@/lib/competition/types'
import { EntryThumb, EntryLightbox } from './media'

export default function StaffPhotos() {
  const [roster, setRoster] = useState<StaffRosterEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<StaffRosterEntry | null>(null)

  useEffect(() => {
    let alive = true
    adminListStaffRoster().then(r => { if (alive) { setRoster(r); setLoading(false) } })
    return () => { alive = false }
  }, [])

  if (selected) return <PersonView person={selected} onBack={() => setSelected(null)} />

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton aspect-[4/3] rounded-xl" />)}
      </div>
    )
  }
  if (!roster.length) {
    return <EmptyState icon={Users} title="No entries yet" description="When staff upload photos, each person will appear here — click anyone to see all of their photos." />
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {roster.map(p => (
        <button
          key={p.entrantId}
          onClick={() => setSelected(p)}
          className="card group overflow-hidden p-0 text-left transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          <div className="aspect-[4/3] overflow-hidden bg-gray-100 dark:bg-gray-800">
            {p.coverUrl
              ? <img src={p.coverUrl} alt="" className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]" />
              : <div className="flex h-full w-full items-center justify-center text-gray-400"><ImageOff className="h-6 w-6" /></div>}
          </div>
          <div className="flex items-center justify-between gap-2 p-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[10px] font-semibold text-brand-700">{initials(p.name)}</span>
              <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{p.name}</span>
            </span>
            <span className="tnum shrink-0 text-sm text-gray-400">{p.count}</span>
          </div>
        </button>
      ))}
    </div>
  )
}

function PersonView({ person, onBack }: { person: StaffRosterEntry; onBack: () => void }) {
  const [entries, setEntries] = useState<EntryWithUrl[]>([])
  const [loading, setLoading] = useState(true)
  const [previewIdx, setPreviewIdx] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    adminStaffEntries(person.entrantId).then(e => { if (alive) { setEntries(e); setLoading(false) } })
    return () => { alive = false }
  }, [person.entrantId])

  // Group by month (newest first) while keeping a flat index for lightbox nav.
  const { months, flat } = useMemo(() => {
    const map = new Map<string, EntryWithUrl[]>()
    for (const e of entries) { const a = map.get(e.month) ?? []; a.push(e); map.set(e.month, a) }
    const months = Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1))
    const flat = months.flatMap(([, list]) => list)
    return { months, flat }
  }, [entries])

  const preview = previewIdx != null ? flat[previewIdx] : null

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="btn-ghost"><ArrowLeft className="h-4 w-4" /> All staff</button>
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">{initials(person.name)}</span>
          <h2 className="section-title">{person.name}</h2>
          <span className="tnum text-sm text-gray-400">{entries.length}</span>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton aspect-square rounded-lg" />)}
        </div>
      ) : !entries.length ? (
        <EmptyState icon={User} title={`No photos from ${person.name}`} description="This person hasn’t entered any photos yet." />
      ) : (
        <div className="space-y-8">
          {months.map(([month, list]) => (
            <section key={month} className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-brand-600">{monthLabel(month)}</p>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {list.map(e => (
                  <EntryThumb
                    key={e.id}
                    entry={e}
                    onClick={() => setPreviewIdx(flat.findIndex(x => x.id === e.id))}
                    overlay={e.placement && (
                      <span className="absolute left-1 top-1 rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {e.placement === 'winner' ? 'Winner' : 'Runner-up'}
                      </span>
                    )}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <EntryLightbox
        entry={preview}
        onClose={() => setPreviewIdx(null)}
        onPrev={preview && previewIdx! > 0 ? () => setPreviewIdx(previewIdx! - 1) : undefined}
        onNext={preview && previewIdx! < flat.length - 1 ? () => setPreviewIdx(previewIdx! + 1) : undefined}
        footer={preview && (
          <div>
            <p className="font-medium">{person.name} · {monthLabel(preview.month)}</p>
            {preview.caption && <p className="text-white/80">{preview.caption}</p>}
          </div>
        )}
      />
    </div>
  )
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase() ?? '').join('')
}
