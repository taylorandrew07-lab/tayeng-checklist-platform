'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Table, LineChart, Images, FileDown, FileText, CheckCircle2, AlertTriangle, PencilLine } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/components/ui/toast'
import { type Voyage } from '@/lib/cargo/types'
import { getRemoteVoyage, remotePhotosToCargoPhotos, type RemotePhoto } from '@/lib/cargo/remote'
import { getVoyageReportNumber, issueReportNumber } from '@/lib/cargo/register'
import { downloadCargoReport } from '@/lib/cargo/pdf/render'
import type { SectionKey } from '@/lib/cargo/dri'
import ClientReadingsView from '@/components/cargo/ClientReadingsView'
import ClientPhotoGallery from '@/components/cargo/ClientPhotoGallery'
import ChartsPanel from '@/components/cargo/ChartsPanel'
import DriReportBuilder from '@/components/cargo/DriReportBuilder'
import ShareLinkPanel from '@/components/cargo/ShareLinkPanel'
import VoyageCorrectionsPanel from '@/components/cargo/VoyageCorrectionsPanel'
import { applyCorrections, type CorrectionPatch } from '@/lib/cargo/corrections'
import Tabs from '@/components/ui/Tabs'
import { withVesselPrefix } from '@/lib/utils'
import { displayVoyageNumber } from '@/lib/cargo/voyageNumber'

type Tab = 'readings' | 'charts' | 'photos' | 'dri' | 'correct'
const BASE_TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'readings', label: 'Readings', icon: Table },
  { id: 'charts', label: 'Charts', icon: LineChart },
  { id: 'photos', label: 'Photos', icon: Images },
]
/** The surveyor's own record, recovered from a corrected voyage: every entry
 *  remembers the value it replaced, so putting those back gives the document as
 *  he wrote it without a second read. */
function unapply(corrected: Voyage, patch: CorrectionPatch | null): Voyage {
  const fields = patch?.fields
  if (!fields) return corrected
  const out = { ...corrected } as Record<string, unknown>
  for (const [k, entry] of Object.entries(fields)) {
    if (!entry) continue
    out[k] = k === 'holdCount' ? Number(entry.from) : entry.from
  }
  return out as unknown as Voyage
}

const DRI_TAB = { id: 'dri' as Tab, label: 'DRI Report', icon: FileText }
const CORRECT_TAB = { id: 'correct' as Tab, label: 'Correct', icon: PencilLine }

/** Read-only remote voyage view (Supabase, not IndexedDB). Used by clients and,
 *  via `backHref`, by admins drilling into a synced voyage from Cargo Operations.
 *  `allowDri` exposes the full DRI Production Report builder (PDF/.docx) for staff
 *  who issue reports from the cloud — generation only; it never writes back to the
 *  surveyor's synced document.
 *  `allowShare` exposes the public data-link panel. Admin only: minting one
 *  publishes the readings to anyone holding the URL, and mig 168 restricts that
 *  to admins and the owning surveyor, so office would only meet a 403. */
export default function ClientCargoWorkspace({ id, backHref = '/client/cargo', allowDri = false, allowShare = false, allowCorrect = false }: { id: string; backHref?: string; allowDri?: boolean; allowShare?: boolean; allowCorrect?: boolean }) {
  const [voyage, setVoyage] = useState<Voyage | null>(null)
  const [photos, setPhotos] = useState<RemotePhoto[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('readings')
  const [generating, setGenerating] = useState(false)
  const [reportNumber, setReportNumber] = useState<string | null>(null)
  // The surveyor's record with NO corrections applied — the panel needs it to
  // show what he actually wrote and to notice when he changes it himself.
  const [original, setOriginal] = useState<Voyage | null>(null)
  const [patch, setPatch] = useState<CorrectionPatch | null>(null)

  useEffect(() => {
    let active = true
    getRemoteVoyage(createClient(), id).then(res => {
      if (!active) return
      if (res) {
        setVoyage(res.voyage)
        setPhotos(res.photos)
        setPatch(res.patch)
        // res.voyage already has the patch applied; re-deriving the original by
        // reading the doc a second time would be a second round trip, so it is
        // reconstructed from the entries' recorded `from` values instead.
        setOriginal(unapply(res.voyage, res.patch))
      }
      setLoading(false)
    }).catch(() => { if (active) setLoading(false) })
    if (allowDri) getVoyageReportNumber(createClient(), id).then(n => { if (active) setReportNumber(n) }).catch(() => {})
    return () => { active = false }
  }, [id, allowDri])

  async function handleDownload() {
    if (!voyage) return
    setGenerating(true)
    try {
      const cargoPhotos = await remotePhotosToCargoPhotos(photos, voyage.id)
      await downloadCargoReport(voyage, cargoPhotos, { quality: 'standard' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not generate the report.')
    } finally {
      setGenerating(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
  if (!voyage) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <h1 className="page-title mb-2">Report not available</h1>
        <p className="text-gray-500 mb-6">This voyage report isn&apos;t available to your account.</p>
        <Link href={backHref} className="btn-secondary">Back</Link>
      </div>
    )
  }

  const finalized = voyage.status === 'finalized'
  const tabs = [...BASE_TABS, ...(allowDri ? [DRI_TAB] : []), ...(allowCorrect ? [CORRECT_TAB] : [])]

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-center gap-4">
        <Link href={backHref} className="btn-ghost py-2 px-3"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="min-w-0 flex-1">
          <h1 className="page-title truncate">{withVesselPrefix(voyage.vesselName, voyage.vesselType)} — {displayVoyageNumber(voyage.voyageNumber)}</h1>
          <p className="text-gray-500 mt-0.5 text-sm">{voyage.cargoType || 'Cargo'} · {voyage.holdCount} holds</p>
        </div>
        {/* Secondary, not primary: the PDF is the photo/record report, while the
            data itself now travels as the shareable link in the panel below. */}
        <button onClick={handleDownload} disabled={generating} className="btn-secondary">
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
          {generating ? 'Preparing…' : 'Download PDF'}
        </button>
      </div>

      {finalized ? (
        <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />This report has been finalised.
        </div>
      ) : (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />Preliminary — monitoring is ongoing. Figures are current as of the last sync and may change. Downloads are marked NOT FINALISED.
        </div>
      )}

      {allowShare && <ShareLinkPanel voyageId={id} />}

      <Tabs
        active={tab}
        onChange={k => setTab(k as Tab)}
        tabs={tabs.map(t => ({ key: t.id, label: <span className="inline-flex items-center gap-2"><t.icon className="h-4 w-4" />{t.label}</span> }))}
      />

      {tab === 'correct' && allowCorrect && original && (
        <VoyageCorrectionsPanel
          voyage={voyage}
          original={original}
          patch={patch}
          onSaved={next => {
            setPatch(next)
            setVoyage(applyCorrections(original, next))
          }}
        />
      )}
      {tab === 'readings' && <ClientReadingsView voyage={voyage} />}
      {tab === 'charts' && <ChartsPanel voyage={voyage} onChange={() => {}} />}
      {tab === 'photos' && <ClientPhotoGallery voyage={voyage} photos={photos} />}
      {/* DRI Report builder reads the synced voyage; onChange is a no-op because the
          surveyor's device owns the document (push-only sync) — staff generate, not edit. */}
      {tab === 'dri' && allowDri && (
        <DriReportBuilder
          voyage={voyage}
          onChange={() => {}}
          photoCount={photos.length}
          loadPhotos={() => remotePhotosToCargoPhotos(photos, voyage.id)}
          reportNumber={reportNumber}
          onIssueNumber={(sections: SectionKey[]) =>
            issueReportNumber(createClient(), {
              voyageId: voyage.id,
              vessel: voyage.vesselName,
              voyageNo: voyage.voyageNumber,
              sections,
            }).then(r => r.reportNumber)
          }
        />
      )}
    </div>
  )
}
