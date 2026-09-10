'use client'

// Files on a P&I case — a contractor's invoice, a receipt, correspondence.
//
// OPENING A STORED FILE IS THE NEW PART. Everywhere else in this app a stored file is
// opened with window.open(signedUrl), and in an installed iOS PWA that is a dead end:
// there is no download manager, so the file lands in a chrome-less window with no share
// button and no way out. So the file is DOWNLOADED to a blob first and then handed to
// deliverFile, which shares on mobile and saves on desktop.
//
// That means two taps on a phone, and it has to: navigator.share needs an UNSPENT user
// gesture, so anything that awaits a download and then shares has already lost it. Tap
// one fetches, tap two sends. Same shape as the job PDF and the labour report.

import { useState, useRef } from 'react'
import { Upload, Trash2, Loader2, FileText, Download, Send } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/components/ui/confirm'
import { formatDate, formatBytes, withTimeout } from '@/lib/utils'
import { deliverFile, isMobileDevice } from '@/lib/pdf/deliver'
import { uploadDocument, deleteDocument, fetchStoredFile, type CaseDocument } from '@/lib/cases/api'

export default function CaseDocuments({ caseId, docs, onChanged }: {
  caseId: string
  docs: CaseDocument[]
  onChanged: () => void
}) {
  const pick = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  // The fetched file waits here for the second tap. Keyed by document id so two rows
  // can never hand each other's file to the share sheet.
  const [ready, setReady] = useState<{ id: string; file: File } | null>(null)
  const [fetching, setFetching] = useState<string | null>(null)

  // Case-level only: a receipt attached to a fee or an attendance is shown on that row.
  const caseLevel = docs.filter(d => !d.attendance_id && !d.charge_id)

  async function onPicked(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    for (const f of Array.from(files)) {
      const res = await withTimeout(uploadDocument(caseId, f), 60_000, `Uploading ${f.name}`)
        .catch((e: Error) => ({ error: e.message }))
      if (res.error) { toast.error(`${f.name}: ${res.error}`); break }
    }
    setBusy(false)
    if (pick.current) pick.current.value = ''
    onChanged()
  }

  /** Tap one. Downloads to memory and stops — no share, no navigation. */
  async function getFile(d: CaseDocument) {
    setFetching(d.id)
    try {
      const file = await fetchStoredFile(d)
      setReady({ id: d.id, file })
      if (!isMobileDevice()) await send(file, d)   // desktop: one tap is enough
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setFetching(null)
    }
  }

  /** Tap two. Deliberately NOT async before deliverFile: an await here would spend the
   *  gesture navigator.share needs, which is exactly how the iPhone bug used to happen. */
  function send(file: File, d: CaseDocument) {
    return deliverFile(file, d.name, file.type, { title: d.name })
      .then(r => { if (r !== 'cancelled') setReady(null) })
      .catch((e: Error) => toast.error(e.message))
  }

  async function remove(d: CaseDocument) {
    if (!(await confirmDialog({
      title: 'Delete this file?', message: d.name, confirmLabel: 'Delete', danger: true,
    }))) return
    const res = await deleteDocument(d)
    if (res.error) { toast.error(res.error); return }
    onChanged()
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-200">
        <h2 className="section-title">Documents</h2>
        <div>
          {/* No accept attribute: on Android that is what keeps the full storage picker
              (and a USB drive) available rather than a photos-only chooser. */}
          <input ref={pick} type="file" multiple className="hidden"
            onChange={e => onPicked(e.target.files)} />
          <button type="button" onClick={() => pick.current?.click()} disabled={busy}
            className="btn-secondary text-xs">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Upload
          </button>
        </div>
      </div>

      {caseLevel.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-gray-400">
          No files yet — invoices, receipts and correspondence can live here.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {caseLevel.map(d => {
            const isReady = ready?.id === d.id
            return (
              <div key={d.id} className="flex items-center gap-3 px-6 py-3">
                <FileText className="h-4 w-4 text-gray-400 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900 truncate">{d.name}</p>
                  <p className="text-xs text-gray-500 tnum">
                    {formatDate(d.created_at)}{d.size_bytes ? ` · ${formatBytes(d.size_bytes)}` : ''}
                  </p>
                </div>
                {isReady ? (
                  <button type="button" onClick={() => send(ready.file, d)} className="btn-primary text-xs">
                    <Send className="h-4 w-4" />Save or send
                  </button>
                ) : (
                  <button type="button" onClick={() => getFile(d)} disabled={fetching === d.id}
                    className="btn-secondary text-xs">
                    {fetching === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Get file
                  </button>
                )}
                <button type="button" onClick={() => remove(d)} aria-label="Delete this file"
                  className="btn-ghost p-1 text-gray-400 hover:text-red-600 flex-shrink-0">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
