'use client'

// Shared bank-account picker for the invoice create + edit surfaces. Carries the
// money-safety warnings both must show: the chosen account's currency vs the invoice
// currency, and (create only) a payer-linked account that couldn't be applied. The
// edit modal previously had no guard here at all, so it could save a currency the
// create builder would refuse.

import type { BankAccount, Currency } from '@/lib/types/database'

interface Props {
  bankAccounts: BankAccount[]
  bankAccountId: string
  bankDetails: string
  currency: Currency
  /** Selecting a saved account (empty string = custom/none). */
  onPickAccount: (id: string) => void
  /** Hand-typed details — the caller should clear the selected account id. */
  onDetailsChange: (details: string) => void
  /** Optional (create flow): the account the payer is linked to, for the notes. */
  linkedAccountId?: string | null
  linkedPartyName?: string
}

export function BankAccountPicker({
  bankAccounts, bankAccountId, bankDetails, currency, onPickAccount, onDetailsChange, linkedAccountId, linkedPartyName,
}: Props) {
  const selectedBank = bankAccounts.find(a => a.id === bankAccountId)
  const bankCurrencyMismatch = !!selectedBank?.currency && selectedBank.currency !== currency
  const linkedUnavailable = !!linkedAccountId && !bankAccounts.some(a => a.id === linkedAccountId)
  const showLinkedNote = !!linkedAccountId && bankAccountId === linkedAccountId

  return (
    <div>
      <label className="text-[11px] text-gray-400">Bank account <span className="text-gray-300">— shown on the invoice</span></label>
      {bankAccounts.length > 0 ? (
        <>
          <select value={bankAccountId} onChange={e => onPickAccount(e.target.value)} className="input-base py-1 text-sm">
            {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.label}{a.currency ? ` (${a.currency})` : ''}</option>)}
            <option value="">Custom / none</option>
          </select>
          {showLinkedNote && linkedPartyName && (
            <p className="text-[11px] text-brand-700 mt-1">{linkedPartyName} is linked to this account — auto-selected.</p>
          )}
          {bankCurrencyMismatch && (
            <p className="text-[11px] text-amber-700 bg-amber-50/70 rounded-md px-2 py-1 mt-1">This account is {selectedBank?.currency}, but the invoice is {currency} — double-check the client pays to the right account.</p>
          )}
          {linkedUnavailable && linkedPartyName && (
            <p className="text-[11px] text-amber-700 mt-1">{linkedPartyName}&apos;s linked account is unavailable — using the default instead.</p>
          )}
        </>
      ) : (
        <p className="text-[11px] text-gray-400">No saved bank accounts — add them in Settings, or type details below.</p>
      )}
      <textarea value={bankDetails} onChange={e => onDetailsChange(e.target.value)} rows={3} placeholder="Bank name, account, SWIFT…" className="input-base text-sm resize-y mt-2" />
    </div>
  )
}
