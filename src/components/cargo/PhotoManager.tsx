'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  DndContext, useDraggable, useDroppable, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { Upload, Trash2, Maximize2, RefreshCw, Check, Loader2, X, ImageOff } from 'lucide-react'
import {
  type Voyage, type CargoPhoto, type Period, type Camera, PERIODS, PERIOD_LABELS, CAMERA_LABELS,
} from '@/lib/cargo/types'
import { monitoringDates, formatVoyageDate, holdNumbers } from '@/lib/cargo/periods'
import { autoAssign } from '@/lib/cargo/assign'
import { getPhotosForVoyage, putPhotos, deletePhoto, newId } from '@/lib/cargo/db'
import { currentUserId } from '@/lib/cargo/user'

interface Props {
  voyage: Voyage
  onChange: (next: Voyage) => void
}

/** Renders a stored blob as an <img>, creating/revoking the object URL safely. */
function BlobImg({ blob, className, alt }: { blob: Blob; className?: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  if (!url) return null
  return <img src={url} className={className} alt={alt} />
}

function setPhotosConfirmed(v: Voyage, date: string, period: Period, value: boolean): Voyage {
  const periodMeta = { ...v.periodMeta }
  const byDate = { ...(periodMeta[date] ?? {}) }
  byDate[period] = { ...(byDate[period] ?? {}), photosConfirmed: value }
  periodMeta[date] = byDate
  return { ...v, periodMeta }
}

function DraggablePhoto({ photo, children }: { photo: CargoPhoto; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: photo.localId })
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} style={{ opacity: isDragging ? 0.4 : 1 }} className="touch-none cursor-grab">
      {children}
    </div>
  )
}

function DropZone({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div ref={setNodeRef} className={`${className ?? ''} ${isOver ? 'ring-2 ring-brand-500 bg-brand-50' : ''}`}>
      {children}
    </div>
  )
}

export default function PhotoManager({ voyage, onChange }: Props) {
  const dates = useMemo(() => monitoringDates(voyage.startDate, voyage.endDate), [voyage.startDate, voyage.endDate])
  const holds = holdNumbers(voyage.holdCount)

  const [userId, setUserId] = useState<string | null>(null)
  const [photos, setPhotos] = useState<CargoPhoto[]>([])
  const [date, setDate] = useState(dates[0] ?? '')
  const [period, setPeriod] = useState<Period>('0600')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<CargoPhoto | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const replaceRef = useRef<HTMLInputElement>(null)
  const replaceTarget = useRef<{ hold: number; camera: Camera } | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const reload = useCallback(async (uid: string) => {
    setPhotos(await getPhotosForVoyage(uid, voyage.id))
  }, [voyage.id])

  useEffect(() => {
    let active = true
    currentUserId().then(async uid => {
      if (!active || !uid) return
      setUserId(uid)
      await reload(uid)
    })
    return () => { active = false }
  }, [reload])

  const here = photos.filter(p => p.dateISO === date && p.period === period)
  const unassigned = here.filter(p => !p.assigned).sort((a, b) => a.order - b.order)
  const slotPhoto = (hold: number, camera: Camera) =>
    here.find(p => p.assigned && p.holdNumber === hold && p.camera === camera)

  const confirmed = !!voyage.periodMeta?.[date]?.[period]?.photosConfirmed
  const nextOrder = () => (photos.reduce((m, p) => Math.max(m, p.order), 0) + 1)

  // Write a batch of photo records atomically and refresh. Returns false (and
  // surfaces the error) if the IndexedDB write fails, so callers don't proceed as
  // if the slot state changed.
  async function persist(updated: CargoPhoto[]): Promise<boolean> {
    try {
      setError(null)
      await putPhotos(updated)
      if (userId) await reload(userId)
      return true
    } catch (err: any) {
      setError(err?.message ?? 'Could not save photos to local storage (it may be full).')
      return false
    }
  }

  // Any change to the current period's photos invalidates a prior "confirmed" review.
  function markUnconfirmed() {
    if (voyage.periodMeta?.[date]?.[period]?.photosConfirmed) {
      onChange(setPhotosConfirmed(voyage, date, period, false))
    }
  }

  async function handleUpload(files: FileList | null) {
    if (!files || !files.length || !userId || !date) return
    const all = Array.from(files)
    const images = all.filter(f => f.type.startsWith('image/'))
    const skipped = all.length - images.length
    if (uploadRef.current) uploadRef.current.value = ''
    if (!images.length) { setError('Those files aren’t images — nothing was added.'); return }

    setBusy(true)
    try {
      const results = await autoAssign(images, voyage.holdCount)
      const toSave: CargoPhoto[] = []
      let order = nextOrder()
      // Track slots taken in THIS batch so two photos don't claim the same slot.
      const claimed = new Set<string>()
      for (const r of results) {
        let holdNumber = r.holdNumber
        let camera = r.camera
        let assigned = r.assigned
        const slotKey = assigned ? `${holdNumber}:${camera}` : ''
        const collision = assigned && (claimed.has(slotKey) || !!slotPhoto(holdNumber as number, camera as Camera))
        if (collision) { holdNumber = null; camera = null; assigned = false } // bump to unassigned for manual review
        if (assigned) claimed.add(slotKey)
        toSave.push({
          localId: newId('photo'), voyageId: voyage.id, userId,
          dateISO: date, period, holdNumber, camera, actualTime: r.actualTime,
          filename: r.file.name, blob: r.file, assigned, order: order++, createdAt: Date.now(),
        })
      }
      const ok = await persist(toSave)
      if (ok) {
        markUnconfirmed() // newly uploaded set needs review again
        if (skipped > 0) setError(`${skipped} non-image file${skipped > 1 ? 's were' : ' was'} skipped.`)
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleReplace(files: FileList | null) {
    const target = replaceTarget.current
    if (!files || !files.length || !userId || !target) return
    const file = files[0]
    if (replaceRef.current) replaceRef.current.value = ''
    replaceTarget.current = null
    if (!file.type.startsWith('image/')) { setError('Please choose an image file.'); return }

    setBusy(true)
    try {
      const existing = slotPhoto(target.hold, target.camera)
      const ok = existing
        ? await persist([{ ...existing, blob: file, filename: file.name }])
        : await persist([{
            localId: newId('photo'), voyageId: voyage.id, userId,
            dateISO: date, period, holdNumber: target.hold, camera: target.camera, actualTime: null,
            filename: file.name, blob: file, assigned: true, order: nextOrder(), createdAt: Date.now(),
          }])
      if (ok) markUnconfirmed()
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(photo: CargoPhoto) {
    try {
      setError(null)
      await deletePhoto(photo.localId)
      if (userId) await reload(userId)
      markUnconfirmed()
    } catch (err: any) {
      setError(err?.message ?? 'Could not delete the photo.')
    }
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over) return
    const photo = photos.find(p => p.localId === active.id)
    if (!photo) return
    const overId = String(over.id)

    if (overId === 'bin:unassigned') {
      if (!photo.assigned) return
      if (await persist([{ ...photo, holdNumber: null, camera: null, assigned: false }])) markUnconfirmed()
      return
    }
    const m = overId.match(/^slot:(\d+):(fwd|aft)$/)
    if (!m) return
    const hold = parseInt(m[1], 10)
    const camera = m[2] as Camera
    if (photo.holdNumber === hold && photo.camera === camera) return

    const updates: CargoPhoto[] = []
    const occupant = slotPhoto(hold, camera)
    if (occupant && occupant.localId !== photo.localId) {
      updates.push({ ...occupant, holdNumber: null, camera: null, assigned: false }) // bump current occupant out
    }
    updates.push({ ...photo, holdNumber: hold, camera, assigned: true })
    if (await persist(updates)) markUnconfirmed()
  }

  function openReplace(hold: number, camera: Camera) {
    replaceTarget.current = { hold, camera }
    replaceRef.current?.click()
  }

  if (dates.length === 0) {
    return <p className="text-sm text-gray-400 py-6 text-center">Set valid monitoring dates on the Setup tab before adding photos.</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label-base">Date</label>
          <select className="input-base" value={date} onChange={e => setDate(e.target.value)}>
            {dates.map(d => <option key={d} value={d}>{formatVoyageDate(d)}</option>)}
          </select>
        </div>
        <div>
          <label className="label-base">Monitoring Period</label>
          <select className="input-base" value={period} onChange={e => setPeriod(e.target.value as Period)}>
            {PERIODS.map(p => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}
          </select>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input ref={uploadRef} type="file" accept="image/*" multiple className="hidden" onChange={e => handleUpload(e.target.files)} />
          <input ref={replaceRef} type="file" accept="image/*" className="hidden" onChange={e => handleReplace(e.target.files)} />
          <button onClick={() => uploadRef.current?.click()} disabled={busy} className="btn-primary">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload Photos
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500">
        Upload all photos for {PERIOD_LABELS[period]} on {formatVoyageDate(date)} at once — the app assigns them by filename
        (e.g. <code className="text-gray-700">H1_FWD.jpg</code>) and EXIF time. Drag any photo to correct its slot. Auto-assignment never replaces your review.
      </p>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        {/* Hold slots */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {holds.map(hold => (
            <div key={hold} className="card p-3">
              <p className="font-semibold text-gray-800 mb-2">Hold {hold}</p>
              <div className="grid grid-cols-2 gap-2">
                {(['fwd', 'aft'] as Camera[]).map(camera => {
                  const p = slotPhoto(hold, camera)
                  return (
                    <DropZone key={camera} id={`slot:${hold}:${camera}`} className="rounded-lg border border-dashed border-gray-300 p-1.5">
                      <p className="text-[11px] font-medium text-gray-500 mb-1">{CAMERA_LABELS[camera]}</p>
                      {p ? (
                        <DraggablePhoto photo={p}>
                          <div className="relative group">
                            <BlobImg blob={p.blob} alt={`Hold ${hold} ${CAMERA_LABELS[camera]}`} className="w-full h-28 object-cover rounded" />
                            <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition">
                              <button onClick={() => setPreview(p)} className="bg-black/60 text-white rounded p-1" title="Preview"><Maximize2 className="h-3 w-3" /></button>
                              <button onClick={() => openReplace(hold, camera)} className="bg-black/60 text-white rounded p-1" title="Replace"><RefreshCw className="h-3 w-3" /></button>
                              <button onClick={() => handleDelete(p)} className="bg-black/60 text-white rounded p-1" title="Delete"><Trash2 className="h-3 w-3" /></button>
                            </div>
                            {p.actualTime && <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1 rounded">{p.actualTime}</span>}
                          </div>
                        </DraggablePhoto>
                      ) : (
                        <button onClick={() => openReplace(hold, camera)} className="w-full h-28 rounded flex flex-col items-center justify-center text-gray-300 hover:text-gray-400 hover:bg-gray-50">
                          <ImageOff className="h-5 w-5 mb-1" /><span className="text-[10px]">Empty</span>
                        </button>
                      )}
                    </DropZone>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Unassigned bin */}
        <DropZone id="bin:unassigned" className="card p-3 mt-3">
          <p className="font-semibold text-gray-800 mb-2">Unassigned Photos {unassigned.length > 0 && <span className="text-amber-600">({unassigned.length})</span>}</p>
          {unassigned.length === 0 ? (
            <p className="text-xs text-gray-400 py-4 text-center">Nothing here. Photos the app couldn&apos;t place confidently land here for manual assignment.</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {unassigned.map(p => (
                <DraggablePhoto key={p.localId} photo={p}>
                  <div className="relative group">
                    <BlobImg blob={p.blob} alt={p.filename} className="w-full h-20 object-cover rounded" />
                    <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition">
                      <button onClick={() => setPreview(p)} className="bg-black/60 text-white rounded p-1"><Maximize2 className="h-3 w-3" /></button>
                      <button onClick={() => handleDelete(p)} className="bg-black/60 text-white rounded p-1"><Trash2 className="h-3 w-3" /></button>
                    </div>
                    <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[9px] px-1 truncate">{p.filename}</span>
                  </div>
                </DraggablePhoto>
              ))}
            </div>
          )}
        </DropZone>
      </DndContext>

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{here.length} photo{here.length !== 1 ? 's' : ''} in this period</p>
        <button
          onClick={() => onChange(setPhotosConfirmed(voyage, date, period, !confirmed))}
          className={confirmed ? 'btn-secondary text-green-700 border-green-300' : 'btn-primary'}
        >
          <Check className="h-4 w-4" />{confirmed ? 'Set Confirmed' : 'Confirm Photo Set'}
        </button>
      </div>

      {/* Fullscreen preview */}
      {preview && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <button className="absolute top-4 right-4 text-white" onClick={() => setPreview(null)}><X className="h-7 w-7" /></button>
          <div className="max-w-5xl max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <BlobImg blob={preview.blob} alt={preview.filename} className="max-w-full max-h-[85vh] object-contain" />
            <p className="text-white text-center text-sm mt-2">
              {preview.assigned ? `Hold ${preview.holdNumber} – ${CAMERA_LABELS[preview.camera as Camera]}` : 'Unassigned'} · {preview.filename}
              {preview.actualTime ? ` · ${preview.actualTime} hrs` : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
