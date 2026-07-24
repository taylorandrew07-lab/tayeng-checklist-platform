'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Trash2, Video, Loader2, Lock, Info, Gavel } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { confirmDialog } from '@/components/ui/confirm'
import { createClient } from '@/lib/supabase/client'
import { COMPETITION_VIDEO_ENABLED } from '@/lib/features'
import { formatDate } from '@/lib/utils'
import {
  currentCompetitionMonth, monthLabel, listMyEntries, withUrls, uploadEntry,
  deleteEntry, updateCaption, readCapturedAt, getRound,
  adminUploadOnBehalf, listEntrants, type Entrant,
} from '@/lib/competition/api'
import type { CompetitionRound, EntryWithUrl } from '@/lib/competition/types'
import { EntryThumb, EntryLightbox } from './media'
import MediaDropZone from './MediaDropZone'

export default function MyPhotos({ isSuperAdmin = false }: { isSuperAdmin?: boolean }) {
  const month = currentCompetitionMonth()
  const [entries, setEntries] = useState<EntryWithUrl[]>([])
  const [round, setRound] = useState<CompetitionRound | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [previewIdx, setPreviewIdx] = useState<number | null>(null)
  const videoInput = useRef<HTMLInputElement>(null)

  // Super-admin only: attribute an upload to another staff member (e.g. a photo
  // sent over WhatsApp). '' = yourself.
  const [attributeTo, setAttributeTo] = useState('')
  const [entrants, setEntrants] = useState<Entrant[]>([])
  const [myUid, setMyUid] = useState<string | null>(null)

  const status = round?.status ?? 'open'
  const acceptingEntries = status === 'open'

  async function refresh() {
    const rows = await listMyEntries(month)
    setEntries(await withUrls(rows))
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [rows, r] = await Promise.all([listMyEntries(month), getRound(month)])
      if (!alive) return
      setRound(r)
      setEntries(await withUrls(rows))
      setLoading(false)
    })()
    return () => { alive = false }
  }, [month])

  // Load the staff list + own id once, only for the super-admin attribute picker.
  useEffect(() => {
    if (!isSuperAdmin) return
    let alive = true
    ;(async () => {
      const { data: { user } } = await createClient().auth.getUser()
      const list = await listEntrants()
      if (!alive) return
      setMyUid(user?.id ?? null)
      setEntrants(list)
    })()
    return () => { alive = false }
  }, [isSuperAdmin])

  async function handleFiles(files: File[], mediaType: 'photo' | 'video') {
    if (!files.length) return
    setError(null); setNotice(null)
    const targetId = isSuperAdmin ? attributeTo : ''
    const targetName = entrants.find(p => p.id === targetId)?.full_name
    let ok = 0
    const problems: string[] = []
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      setBusy(`Uploading ${i + 1} of ${files.length}…`)
      // Reject unsupported formats up front with a friendly message instead of a
      // raw storage error, and keep going through the rest of the batch.
      if (mediaType === 'photo' && !isSupportedImage(f)) {
        problems.push(`${f.name}: use a JPG, PNG or WebP (an iPhone HEIC won’t upload)`); continue
      }
      const capturedAt = mediaType === 'photo' ? await readCapturedAt(f) : null
      const res = targetId
        ? await adminUploadOnBehalf(f, targetId, { mediaType, capturedAt })
        : await uploadEntry(f, { mediaType, capturedAt })
      if (res.error) { problems.push(`${f.name}: ${friendlyUploadError(res.error)}`); continue }
      ok++
    }
    setBusy(null)
    if (ok && !targetId) await refresh()
    if (ok && targetId) {
      setNotice(`Added ${ok} ${ok === 1 ? 'photo' : 'photos'} to ${targetName ?? 'that person'}. Find it under Staff Photos.`)
      setAttributeTo('') // reset so the next upload defaults back to "Yours"
    }
    setError(problems.length === 0 ? null
      : problems.length === 1 ? problems[0]
      : `${problems.length} not added — ${problems.slice(0, 2).join('; ')}${problems.length > 2 ? '…' : ''}`)
  }

  async function remove(entry: EntryWithUrl) {
    if (!(await confirmDialog({ title: 'Remove photo', message: 'Remove this entry from the competition?', danger: true, confirmLabel: 'Remove' }))) return
    setPreviewIdx(null)
    const res = await deleteEntry(entry)
    if (res.error) { setError(res.error); return }
    await refresh()
  }

  const preview = previewIdx != null ? entries[previewIdx] : null

  return (
    <div className="space-y-5">
      {/* This month — theme + status + privacy note */}
      <div className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-brand-600">{monthLabel(month)}</p>
            <h2 className="section-title mt-0.5">{round?.theme ? round.theme : 'This month’s photos'}</h2>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-500">
              <Info className="h-3.5 w-3.5 shrink-0" />
              Only you and the admins can see your entries. Winners are shown to everyone.
            </p>
          </div>
          {status === 'open'
            ? <Badge tone="success">Open for entries</Badge>
            : status === 'judging'
              ? <Badge tone="neutral"><Gavel className="mr-1 h-3 w-3" />Judging under way</Badge>
              : <Badge tone="neutral"><Lock className="mr-1 h-3 w-3" />Results are in</Badge>}
        </div>

        {acceptingEntries && (
          <div className="mt-4 space-y-2">
            {isSuperAdmin && (
              <div>
                <label className="label-base">Whose photo is this?</label>
                <select className="input-base sm:max-w-xs" value={attributeTo} onChange={e => setAttributeTo(e.target.value)}>
                  <option value="">Yours</option>
                  {entrants.filter(p => p.id !== myUid).map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </div>
            )}
            <MediaDropZone
              onFiles={imgs => handleFiles(imgs, 'photo')}
              disabled={!!busy}
              busy={busy}
              hint={attributeTo ? <>Uploading as <strong>{entrants.find(p => p.id === attributeTo)?.full_name}</strong></> : undefined}
            />
            {COMPETITION_VIDEO_ENABLED && (
              <button className="btn-secondary" onClick={() => videoInput.current?.click()} disabled={!!busy}>
                <Video className="h-4 w-4" /> Add video
              </button>
            )}
          </div>
        )}
        {notice && <p className="mt-2 text-sm text-brand-700">{notice}</p>}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        {COMPETITION_VIDEO_ENABLED && (
          <input
            ref={videoInput} type="file" accept="video/*" multiple className="hidden"
            onChange={e => { handleFiles(Array.from(e.target.files ?? []), 'video'); e.target.value = '' }}
          />
        )}
      </div>

      {/* My grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton aspect-square rounded-lg" />)}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={Camera}
          title="No photos yet"
          description={acceptingEntries
            ? 'Add your best shots for this month — dockside, aboard, sunrise at sea, whatever tells the story.'
            : status === 'judging' ? 'Judging is under way — entries are closed for this month.' : 'This month is closed.'}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {entries.map((e, i) => (
            <EntryThumb
              key={e.id}
              entry={e}
              onClick={() => setPreviewIdx(i)}
              overlay={acceptingEntries && (
                <button
                  onClick={ev => { ev.stopPropagation(); remove(e) }}
                  aria-label="Remove"
                  className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity duration-150 hover:bg-black/75 group-hover:opacity-100"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            />
          ))}
        </div>
      )}

      <EntryLightbox
        entry={preview}
        onClose={() => setPreviewIdx(null)}
        onPrev={preview && previewIdx! > 0 ? () => setPreviewIdx(previewIdx! - 1) : undefined}
        onNext={preview && previewIdx! < entries.length - 1 ? () => setPreviewIdx(previewIdx! + 1) : undefined}
        footer={preview && (
          <CaptionFooter
            entry={preview}
            editable={acceptingEntries}
            onSaved={cap => { setEntries(list => list.map(x => x.id === preview.id ? { ...x, caption: cap } : x)) }}
            onRemove={acceptingEntries ? () => remove(preview) : undefined}
          />
        )}
      />
    </div>
  )
}

/** The photo bucket only accepts JPG/PNG/WebP (mig 159). Pre-check so an
 *  unsupported file (e.g. an iPhone HEIC that Safari didn't transcode) gets a
 *  friendly message rather than a raw storage error. */
function isSupportedImage(f: File): boolean {
  return /^image\/(jpe?g|png|webp)$/i.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name)
}
function friendlyUploadError(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('mime') || m.includes('not supported') || m.includes('invalid')) return 'that format isn’t supported — use JPG, PNG or WebP'
  if (m.includes('maximum') || m.includes('exceed') || m.includes('too large') || m.includes('payload')) return 'it’s over the 25 MB limit'
  return msg
}

function CaptionFooter({ entry, editable, onSaved, onRemove }: {
  entry: EntryWithUrl
  editable: boolean
  onSaved: (caption: string) => void
  onRemove?: () => void
}) {
  const [caption, setCaption] = useState(entry.caption ?? '')
  const [saving, setSaving] = useState(false)
  useEffect(() => { setCaption(entry.caption ?? '') }, [entry.id, entry.caption])

  async function save() {
    setSaving(true)
    const res = await updateCaption(entry, caption)
    setSaving(false)
    if (!res.error) onSaved(caption.trim())
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2">
      {entry.captured_at && <p className="text-xs text-white/60">Taken {formatDate(entry.captured_at)}</p>}
      {editable ? (
        <div className="flex w-full items-center gap-2">
          <input
            value={caption}
            onChange={e => setCaption(e.target.value)}
            placeholder="Add a caption (optional)"
            className="min-w-0 flex-1 rounded-md border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/50 focus:border-white/40 focus:outline-none"
          />
          <button onClick={save} disabled={saving} className="btn-primary shrink-0">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
          </button>
        </div>
      ) : entry.caption ? <p className="text-sm text-white/90">{entry.caption}</p> : null}
      {onRemove && (
        <button onClick={onRemove} className="inline-flex items-center gap-1.5 text-sm text-white/70 hover:text-white">
          <Trash2 className="h-4 w-4" /> Remove entry
        </button>
      )}
    </div>
  )
}
