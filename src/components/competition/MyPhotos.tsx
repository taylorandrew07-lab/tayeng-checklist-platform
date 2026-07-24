'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Upload, FolderOpen, Trash2, Video, Loader2, Lock, Info } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { confirmDialog } from '@/components/ui/confirm'
import { pickImageFiles } from '@/lib/files/pickImageFiles'
import { COMPETITION_VIDEO_ENABLED } from '@/lib/features'
import { formatDate } from '@/lib/utils'
import {
  currentCompetitionMonth, monthLabel, listMyEntries, withUrls, uploadEntry,
  deleteEntry, updateCaption, readCapturedAt, getRound,
} from '@/lib/competition/api'
import type { CompetitionRound, EntryWithUrl } from '@/lib/competition/types'
import { EntryThumb, EntryLightbox } from './media'

export default function MyPhotos() {
  const month = currentCompetitionMonth()
  const [entries, setEntries] = useState<EntryWithUrl[]>([])
  const [round, setRound] = useState<CompetitionRound | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewIdx, setPreviewIdx] = useState<number | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const videoInput = useRef<HTMLInputElement>(null)

  const closed = round?.status === 'closed'

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

  async function handleFiles(files: File[], mediaType: 'photo' | 'video') {
    if (!files.length) return
    setError(null)
    let ok = 0
    for (let i = 0; i < files.length; i++) {
      setBusy(`Uploading ${i + 1} of ${files.length}…`)
      const capturedAt = mediaType === 'photo' ? await readCapturedAt(files[i]) : null
      const res = await uploadEntry(files[i], { mediaType, capturedAt })
      if (res.error) { setError(res.error); break }
      ok++
    }
    setBusy(null)
    if (ok) await refresh()
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
          {closed
            ? <Badge tone="neutral"><Lock className="mr-1 h-3 w-3" />Results are in</Badge>
            : <Badge tone="success">Open for entries</Badge>}
        </div>

        {!closed && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => photoInput.current?.click()} disabled={!!busy}>
              <Upload className="h-4 w-4" /> Add photos
            </button>
            <button className="btn-secondary" onClick={() => pickImageFiles((imgs) => handleFiles(imgs, 'photo'))} disabled={!!busy}>
              <FolderOpen className="h-4 w-4" /> Files / USB
            </button>
            {COMPETITION_VIDEO_ENABLED && (
              <button className="btn-secondary" onClick={() => videoInput.current?.click()} disabled={!!busy}>
                <Video className="h-4 w-4" /> Add video
              </button>
            )}
            {busy && <span className="inline-flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> {busy}</span>}
          </div>
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        <input
          ref={photoInput} type="file" accept="image/*" multiple className="hidden"
          onChange={e => { handleFiles(Array.from(e.target.files ?? []), 'photo'); e.target.value = '' }}
        />
        <input
          ref={videoInput} type="file" accept="video/*" multiple className="hidden"
          onChange={e => { handleFiles(Array.from(e.target.files ?? []), 'video'); e.target.value = '' }}
        />
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
          description={closed ? 'This month is closed for entries.' : 'Add your best shots for this month — dockside, aboard, sunrise at sea, whatever tells the story.'}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {entries.map((e, i) => (
            <EntryThumb
              key={e.id}
              entry={e}
              onClick={() => setPreviewIdx(i)}
              overlay={!closed && (
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
            editable={!closed}
            onSaved={cap => { setEntries(list => list.map(x => x.id === preview.id ? { ...x, caption: cap } : x)) }}
            onRemove={!closed ? () => remove(preview) : undefined}
          />
        )}
      />
    </div>
  )
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
