'use client'

// The two quick billable buttons: one tap, ten minutes, no form.
//
// THEY WORK BACKWARDS. You finish a twenty-minute call, pick the app up and tap twice —
// so the time is already in the past. The first tap covers the ten minutes ending now,
// the second the ten before that, and the two lie end to end. The chaining is done in
// the database (migs 218, 220), not here, so it is right no matter which screen taps it.
//
// Each tap mints its OWN key. That is the distinction the idempotency rests on: two taps
// are meant to make two chunks, but one tap replayed over a flaky connection must not.
//
// A tap prices itself from the case's standing rate for that kind of work, so the rate is
// typed once under Rates rather than on every line. Without one the entry is still logged
// — it simply stays outstanding until it has a rate, instead of being claimed at nothing.

import { useState } from 'react'
import { Phone, Mail, Loader2 } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { addQuickBlock, rateDefaultFor, type CaseRow } from '@/lib/cases/api'
import { QUICK_BLOCK_MINUTES } from '@/lib/cases/minutes'

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function QuickBlocks({ kase, onAdded }: { kase: CaseRow; onAdded: () => void }) {
  const [busy, setBusy] = useState<'call' | 'email' | null>(null)

  const rate = (label: string) => {
    const d = rateDefaultFor(kase, label)
    return d ? `${money(d.rate)} ${d.currency} per hour` : 'No rate set yet — set one under Rates'
  }

  async function tap(kind: 'call' | 'email') {
    setBusy(kind)
    const res = await addQuickBlock(kase.id, kind, crypto.randomUUID())
    setBusy(null)
    if (res.error) { toast.error(res.error); return }
    toast.success(`${kind === 'call' ? 'Phone call' : 'Email'} — ${QUICK_BLOCK_MINUTES} min added`)
    onAdded()
  }

  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => tap('call')} disabled={busy !== null}
        className="btn-secondary text-xs"
        title={`Logs the ten minutes ending now — tap twice for a twenty-minute call. ${rate('Phone call')}.`}>
        {busy === 'call' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
        Phone call <span className="tnum opacity-70">+10m</span>
      </button>
      <button type="button" onClick={() => tap('email')} disabled={busy !== null}
        className="btn-secondary text-xs"
        title={`Logs the ten minutes ending now — tap twice for twenty. ${rate('Email')}.`}>
        {busy === 'email' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
        Email <span className="tnum opacity-70">+10m</span>
      </button>
    </div>
  )
}
