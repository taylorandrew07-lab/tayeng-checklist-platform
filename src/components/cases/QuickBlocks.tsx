'use client'

// The two quick billable buttons: one tap, ten minutes, no form.
//
// THEY WORK BACKWARDS. You finish a twenty-minute call, pick the app up and tap twice —
// so the time is already in the past. The first tap covers the ten minutes ending now,
// the second the ten before that, and the two lie end to end. The chaining is done in
// the database (mig 218), not here, so it is right no matter which screen taps it.
//
// Each tap mints its OWN key. That is the distinction the idempotency rests on: two taps
// are meant to make two chunks, but one tap replayed over a flaky connection must not.
//
// The blocks are billable TIME and land in Attendances. They live on the Fees and costs
// card because that is where the money on a case is worked, and the toast says where the
// entry went so nothing appears to vanish.

import { useState } from 'react'
import { Phone, Mail, Loader2 } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { addQuickBlock } from '@/lib/cases/api'
import { QUICK_BLOCK_MINUTES } from '@/lib/cases/minutes'

export default function QuickBlocks({ caseId, onAdded }: { caseId: string; onAdded: () => void }) {
  const [busy, setBusy] = useState<'call' | 'email' | null>(null)

  async function tap(kind: 'call' | 'email') {
    setBusy(kind)
    const res = await addQuickBlock(caseId, kind, crypto.randomUUID())
    setBusy(null)
    if (res.error) { toast.error(res.error); return }
    toast.success(`${kind === 'call' ? 'Phone call' : 'Email'} — ${QUICK_BLOCK_MINUTES} min added to attendances`)
    onAdded()
  }

  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => tap('call')} disabled={busy !== null}
        className="btn-secondary text-xs"
        title="Logs the ten minutes ending now. Tap twice for a twenty-minute call.">
        {busy === 'call' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
        Phone call <span className="tnum opacity-70">+10m</span>
      </button>
      <button type="button" onClick={() => tap('email')} disabled={busy !== null}
        className="btn-secondary text-xs"
        title="Logs the ten minutes ending now. Tap twice for twenty.">
        {busy === 'email' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
        Email <span className="tnum opacity-70">+10m</span>
      </button>
    </div>
  )
}
