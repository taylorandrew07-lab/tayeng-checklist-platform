'use client'

// Closing off a period on a case.
//
// It is NOT an invoice, and nothing here creates one. It produces a schedule — PDF or
// CSV — of the time and costs being billed, and then, separately, records that those
// lines have been invoiced outside the app so the next claim skips them.
//
// EXPORT FIRST, MARK SECOND, and marking is deliberately not gated on having exported.
// The button order is the nudge; a hard gate would just fight you at 11pm when you have
// already sent the invoice from somewhere else.
//
// ONE CURRENCY PER CLAIM. There is no control here that could mix two, and the RPC
// re-checks it in SQL — a case with USD time and TTD disbursements produces two claims,
// because there is no exchange rate anywhere in this app and inventing one would put a
// number on a client's invoice that their bank will not reproduce.

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Loader2, FileText, Table, Send, CheckCircle2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils'
import { todayKey } from '@/lib/cargo/voyageDate'
import { deliverFile, isMobileDevice, PDF_MIME, CSV_MIME } from '@/lib/pdf/deliver'
import { createClaim, markClaimInvoiced, type CaseRow, type CaseAttendance, type CaseCharge } from '@/lib/cases/api'
import { caseTitle } from '@/lib/cases/title'
import {
  claimPosition, claimLines, claimTimeLabel, claimCsv, claimFilename, heldBack, defaultCutoff,
} from '@/lib/cases/claim'

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Built = { kind: 'pdf' | 'csv'; file: File }

export default function ClaimCaseModal({ open, onClose, kase, attendances, charges, onClaimed }: {
  open: boolean
  onClose: () => void
  kase: CaseRow | null
  attendances: CaseAttendance[]
  charges: CaseCharge[]
  onClaimed: () => void
}) {
  const [cutoff, setCutoff] = useState(todayKey())
  const [picked, setPicked] = useState<string | null>(null)
  const [built, setBuilt] = useState<Built | null>(null)
  const [busy, setBusy] = useState<'pdf' | 'csv' | 'claim' | null>(null)
  // Set once the claim exists, so the reference prompt replaces the export controls.
  const [claimed, setClaimed] = useState<{ id: string; no: number } | null>(null)
  const [reference, setReference] = useState('')
  const [invoicedOn, setInvoicedOn] = useState(todayKey())

  useEffect(() => {
    if (!open) return
    // Far enough to include everything outstanding, never earlier than today. Opening this
    // dialog should show the whole bill; moving the date back is how work is held over.
    setCutoff(defaultCutoff(attendances, charges, todayKey()))
    setPicked(null); setBuilt(null); setClaimed(null)
    setReference(''); setInvoicedOn(todayKey())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const position = useMemo(
    () => claimPosition(attendances, charges, cutoff),
    [attendances, charges, cutoff],
  )
  // Anything outstanding that this cutoff cannot see. Never left unsaid: the header counts
  // the whole case, so a silent difference reads as work having gone missing.
  const held = useMemo(
    () => heldBack(attendances, charges, cutoff),
    [attendances, charges, cutoff],
  )
  const group = position.groups.find(g => g.currency === picked) ?? position.groups[0] ?? null

  // A stale file is worse than no file: if the cutoff or the currency moves, whatever was
  // built no longer describes what is about to be claimed.
  useEffect(() => { setBuilt(null) }, [cutoff, picked])

  const build = useCallback(async (kind: 'pdf' | 'csv') => {
    if (!kase || !group) return
    setBusy(kind)
    try {
      const name = claimFilename(kase, group.currency, cutoff, kind)
      let file: File
      if (kind === 'csv') {
        // BOM so Excel opens it as UTF-8 rather than mangling a vessel name.
        file = new File(['﻿' + claimCsv(kase, group, cutoff)], name, { type: CSV_MIME })
      } else {
        // Dynamically imported so @react-pdf never lands in the case page's bundle.
        const [{ pdf }, { CaseClaimPDF }] = await Promise.all([
          import('@react-pdf/renderer'),
          import('@/lib/pdf/CaseClaimPDF'),
        ])
        const blob = await pdf(CaseClaimPDF({
          caseTitle: caseTitle(kase), caseType: kase.case_type, ourVessel: kase.our_vessel,
          otherParty: kase.other_party, caseRef: kase.case_ref, principal: kase.principal,
          currency: group.currency, cutoff, claimNo: claimed?.no ?? null,
          timeLabel: claimTimeLabel(group),
          lines: claimLines(group), total: group.total,
        })).toBlob()
        file = new File([blob], name, { type: PDF_MIME })
      }
      setBuilt({ kind, file })
      // Desktop wants the file, not a two-step. Mobile keeps it for the share gesture.
      if (!isMobileDevice()) { await deliverFile(file, file.name, file.type, { title: file.name }); setBuilt(null) }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }, [kase, group, cutoff, claimed])

  /** Second tap on mobile. No await before deliverFile — that would spend the gesture
   *  navigator.share needs, which is the whole reason this is two taps. */
  function send() {
    if (!built) return
    deliverFile(built.file, built.file.name, built.file.type, { title: built.file.name })
      .then(r => { if (r !== 'cancelled') setBuilt(null) })
      .catch((e: Error) => toast.error(e.message))
  }

  async function doClaim() {
    if (!kase || !group) return
    setBusy('claim')
    const res = await createClaim({ caseId: kase.id, currency: group.currency, cutoff })
    setBusy(null)
    if (res.error) { toast.error(res.error); return }
    setClaimed({ id: res.claim!.claim_id, no: res.claim!.claim_no })
    toast.success(`Claim ${res.claim!.claim_no} — ${res.claim!.items} item${res.claim!.items === 1 ? '' : 's'}`)
    onClaimed()
  }

  async function saveReference() {
    if (!claimed) return
    setBusy('claim')
    const res = await markClaimInvoiced(claimed.id, reference, invoicedOn)
    setBusy(null)
    if (res.error) { toast.error(res.error); return }
    onClaimed()
    onClose()
  }

  const others = position.groups.filter(g => g.currency !== group?.currency)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={claimed ? `Claim ${claimed.no} created` : `Close off billing — ${kase ? caseTitle(kase) : 'case'}`}
      size="xl"
      footer={claimed ? (
        <>
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Done</button>
          <button type="button" onClick={saveReference} disabled={busy !== null} className="btn-primary text-sm">
            {busy === 'claim' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Save invoice details
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button type="button" onClick={doClaim} disabled={busy !== null || !group || group.itemCount === 0}
            className="btn-primary text-sm">
            {busy === 'claim' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Mark as claimed
          </button>
        </>
      )}
    >
      {claimed ? (
        // The claim exists and its lines are stamped. This is the "note the invoice"
        // step, and it is entirely skippable — Done closes without a reference.
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Those items are marked as claimed and won’t appear on the next one.
            If you have the invoice number, record it here so you can trace them back later.
          </p>
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="label-base" htmlFor="cl-ref">Invoice number</label>
              <input id="cl-ref" className="input-base" value={reference} autoFocus
                placeholder="Leave blank if you don’t have it yet"
                onChange={e => setReference(e.target.value)} />
            </div>
            <div>
              <label className="label-base" htmlFor="cl-on">Invoice date</label>
              <input id="cl-on" type="date" className="input-base w-40" value={invoicedOn}
                onChange={e => setInvoicedOn(e.target.value)} />
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="label-base" htmlFor="cl-cutoff">Bill everything up to</label>
              <input id="cl-cutoff" type="date" className="input-base w-44" value={cutoff}
                onChange={e => setCutoff(e.target.value)} />
            </div>
            {held.count > 0 && held.latest && (
              <div className="flex items-end gap-2 pb-0.5">
                <p className="text-xs text-amber-700 max-w-xs">
                  {held.count} {held.count === 1 ? 'entry is' : 'entries are'} dated after this —{' '}
                  {Object.entries(held.totals).map(([ccy, amt]) => `${money(amt)} ${ccy}`).join(' and ')},
                  not in this claim.
                </p>
                <button type="button" onClick={() => setCutoff(held.latest as string)}
                  className="btn-secondary text-xs whitespace-nowrap">
                  Include {held.count === 1 ? 'it' : 'them'}
                </button>
              </div>
            )}
            {position.groups.length > 1 && (
              <div className="flex flex-wrap gap-2 pb-1">
                {position.groups.map(g => (
                  <button key={g.currency} type="button" onClick={() => setPicked(g.currency)}
                    aria-pressed={g.currency === group?.currency}
                    className={`text-sm px-3 py-1 rounded-full border transition-colors tnum ${
                      g.currency === group?.currency
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                    {g.currency} {money(g.total)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {!group || group.itemCount === 0 ? (
            <p className="text-sm text-gray-500">
              Nothing outstanding on or before {formatDate(cutoff)}.
              {position.unpriced.length > 0 && ' Everything logged is still waiting on a rate.'}
            </p>
          ) : (
            <>
              <div className="card divide-y divide-gray-100 max-h-72 overflow-y-auto">
                {claimLines(group).map((l, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="text-xs text-gray-500 tnum w-24 flex-shrink-0">{formatDate(l.date)}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {l.detail}{l.who ? <span className="text-gray-500"> — {l.who}</span> : null}
                    </span>
                    <span className="text-xs text-gray-400 w-20 text-right flex-shrink-0">{l.basis}</span>
                    <span className="tnum w-24 text-right flex-shrink-0">{money(l.amount)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50">
                  <span className="text-sm font-medium text-gray-700">
                    Total · {group.itemCount} item{group.itemCount === 1 ? '' : 's'} · {claimTimeLabel(group)}
                  </span>
                  <span className="text-sm font-semibold text-gray-900 tnum">{money(group.total)} {group.currency}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {built ? (
                  <button type="button" onClick={send} className="btn-primary text-sm">
                    <Send className="h-4 w-4" />Save or send the {built.kind.toUpperCase()}
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={() => build('pdf')} disabled={busy !== null} className="btn-secondary text-sm">
                      {busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}Export PDF
                    </button>
                    <button type="button" onClick={() => build('csv')} disabled={busy !== null} className="btn-secondary text-sm">
                      {busy === 'csv' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Table className="h-4 w-4" />}Export CSV
                    </button>
                  </>
                )}
              </div>
            </>
          )}

          {position.unpriced.length > 0 && (
            <p className="text-sm text-amber-700">
              {position.unpriced.length} entr{position.unpriced.length === 1 ? 'y has' : 'ies have'} no rate
              and will not be included. Time with no rate is never billed at zero.
            </p>
          )}

          {others.length > 0 && (
            <p className="text-xs text-gray-500">
              {others.map(g => `${g.currency} ${money(g.total)}`).join(' and ')} stays outstanding —
              claim {others.length === 1 ? 'it' : 'them'} separately. One claim carries one currency,
              and nothing here is ever converted.
            </p>
          )}

          <p className="text-xs text-gray-500">
            No invoice is created in this app. Anything logged after {formatDate(cutoff)} — and anything
            added later but dated on or before it — stays outstanding for the next claim.
          </p>
        </div>
      )}
    </Modal>
  )
}
