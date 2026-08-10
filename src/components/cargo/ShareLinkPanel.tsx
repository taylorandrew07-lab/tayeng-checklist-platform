'use client'

// "Get link" — the shareable, read-only web view of a voyage's readings and
// charts, for sending to a client. Used by the surveyor who owns the voyage and
// by admins reviewing it; mig 168 decides which of them may actually mint one.
//
// The link opens a standalone document at /r/<token>. It is NOT a login and
// gives the holder no access to the app, which is worth saying on screen —
// whoever presses this button is about to email it to somebody outside the firm.

import { useCallback, useEffect, useState } from 'react'
import { Link2, Copy, Check, Loader2, Eye, ExternalLink, ShieldOff } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/components/ui/confirm'

export interface ShareLink {
  url: string
  createdAt: string
  viewCount: number
  lastViewedAt: string | null
}

interface Props {
  voyageId: string
  /** False while the voyage still has unsynced local changes — the annex renders
   *  from the synced row, so a link made now would show stale figures. */
  canShare?: boolean
  unsyncedHint?: string
}

export default function ShareLinkPanel({ voyageId, canShare = true, unsyncedHint }: Props) {
  const [link, setLink] = useState<ShareLink | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/cargo/share?voyageId=${encodeURIComponent(voyageId)}`)
      const json = await res.json()
      setLink(res.ok ? json.link : null)
    } catch {
      setLink(null)
    } finally {
      setLoading(false)
    }
  }, [voyageId])

  useEffect(() => { load() }, [load])

  async function create() {
    setBusy(true)
    try {
      const res = await fetch('/api/cargo/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ voyageId }),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error ?? 'Could not create the link.'); return }
      setLink(json.link)
      if (json.created) toast.success('Link created.')
    } catch {
      toast.error('Could not create the link.')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.error('Could not copy — select the link and copy it manually.')
    }
  }

  async function revoke() {
    const ok = await confirmDialog({
      title: 'Withdraw this link?',
      message: 'Anyone holding it will immediately lose access. A new link can be created afterwards, but it will be a different address — this one can never be reinstated.',
      confirmLabel: 'Withdraw link',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch(`/api/cargo/share?voyageId=${encodeURIComponent(voyageId)}`, { method: 'DELETE' })
      if (!res.ok) { toast.error('Could not withdraw the link.'); return }
      setLink(null)
      toast.success('Link withdrawn.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="card p-4 flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Checking for a link…</div>

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-brand-50 text-brand-700 p-2"><Link2 className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-sm">Shareable data link</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            A read-only web page of every reading and chart for this voyage — the full voyage
            side to side, all holds top to bottom. Photos stay in the PDF report.
          </p>
        </div>
      </div>

      {!link ? (
        <>
          <button onClick={create} disabled={busy || !canShare} className="btn-primary w-full sm:w-auto">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            {busy ? 'Creating…' : 'Get link'}
          </button>
          {!canShare && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
              {unsyncedHint ?? 'Sync this voyage first — the link shows the synced figures.'}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              readOnly
              value={link.url}
              onFocus={e => e.currentTarget.select()}
              className="input-base flex-1 font-mono text-xs"
              aria-label="Shareable link"
            />
            <div className="flex gap-2">
              <button onClick={copy} className="btn-secondary whitespace-nowrap">
                {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <a href={link.url} target="_blank" rel="noopener noreferrer" className="btn-ghost whitespace-nowrap">
                <ExternalLink className="h-4 w-4" />Open
              </a>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5" />
              {link.viewCount === 0 ? 'Not opened yet' : `Opened ${link.viewCount} time${link.viewCount === 1 ? '' : 's'}`}
            </span>
            <button onClick={revoke} disabled={busy} className="inline-flex items-center gap-1.5 text-red-600 hover:text-red-700 hover:underline">
              <ShieldOff className="h-3.5 w-3.5" />Withdraw link
            </button>
          </div>
        </>
      )}

      <p className="text-[11px] text-gray-400 leading-relaxed border-t border-gray-100 pt-2.5">
        Anyone with the link can open the page — no sign-in needed. It shows this voyage&apos;s
        readings only, and gives no access to the app or to any other job, client or voyage.
      </p>
    </div>
  )
}
