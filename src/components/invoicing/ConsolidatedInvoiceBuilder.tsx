'use client'

// Finance-side invoice creation, in two modes.
//
// "Bill jobs" pulls the jobs that are done but not yet billed, filtered by client
// (and optionally month), so you can put many vessels on ONE invoice — and address
// it to a third-party payer (the "bill to" dropdown) when someone other than the
// work client pays (e.g. ASCO pays for BP's vessels). Creating the invoice stamps
// each job with it and CLOSES it (migration 145), which is also what locks surveyor
// edits — so only jobs you've marked "invoice ready" are billable here; submitted
// ones sit in a review group with a one-click promote.
//
// "Blank invoice" is a client plus hand-typed lines and nothing else: no job pool,
// no job created. An invoice needs a client, lines and a total — a job is not one of
// its requirements (the ledger, the PDF, the client page and the billing totals all
// read the invoice directly), so a reimbursed launch fee no longer has to invent a
// vessel-shaped job to be billed. Putting it on the job sheet is now a tick-box.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Receipt, Users, CheckSquare, Square, Paperclip, ArrowUpDown, Plus, X } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { formatDate, parseVesselName, withVesselPrefix } from '@/lib/utils'
import { jobLastDate, jobLastDateKey, jobSpansDays } from '@/lib/jobs/jobDate'
import { money, CURRENCIES, listJobTypes } from '@/lib/jobs/tracker'
import {
  listBillingClients, listInvoiceableJobs, listClientRates, getAppSettings, listBankAccounts,
  createConsolidatedInvoice, getLatestInvoiceNumber, computeTotals, markJobInvoiceReady, pickRate, billedDays, seedCharge,
  type InvoiceableJob, type TaxDraft,
} from '@/lib/jobs/invoicing'
import { groupDraughtVoyages, isRollUp, isBillableAsVoyage, describeGrouping, type VoyageGroup } from '@/lib/jobs/voyage'
import { seedVoyageLine, describeBlock, breakdownNote, type VoyageLineSeed } from '@/lib/jobs/voyageBilling'
import { fetchVoyageContext, describeContextProblem, type VoyageContext } from '@/lib/jobs/voyageContext'
import { listClientBilling } from '@/lib/clients/billing'
import LineItemsEditor, { blankLine, type DraftLine } from '@/components/invoicing/LineItemsEditor'
import { TaxEditor, TotalsSummary } from '@/components/invoicing/TaxEditor'
import { BankAccountPicker } from '@/components/invoicing/BankAccountPicker'
import type { Currency, ClientRate, BankAccount } from '@/lib/types/database'

// rate_id is the rate this line is priced from. Seeded by pickRate() and then
// overridable per line, so a job whose rate was auto-matched wrongly (or that has
// several candidate rates) can be corrected without retyping the price.
interface LineState { description: string; qty: number; unit_price: number; rate_id: string | null }

// One job can carry SEVERAL charges, so its lines are an array, not a single line.
// Ultrasonic Hatch Testing is the case that forced it: the client pays per hatch
// cover AND per cargo hold, two different rates on the same attendance, and with one
// line per job the second charge could only be typed in by hand as a loose extra
// line — unlinked to the job, so it never showed in reconciliation.

// How the job pool is ordered. This is not just a browsing convenience: the picker's
// order IS the order the lines come out on the invoice (see orderedLines), so sorting
// by vessel groups a client's vessels together on the printed invoice, and sorting by
// date runs it chronologically. Defaults to date ascending, which is how the list has
// always read (oldest work first).
type SortKey = 'date' | 'vessel' | 'type'
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'date', label: 'Date' },
  { key: 'vessel', label: 'Vessel' },
  { key: 'type', label: 'Job type' },
]

// Date sorts on the job's LAST day, matching the date shown on the row (jobDate.ts).
// The stage is part of the type key so Draught Survey (Initial) and (Final) don't
// interleave.
function sortValue(j: InvoiceableJob, key: SortKey): string {
  if (key === 'vessel') return (j.vessel_name ?? '').trim().toLowerCase()
  if (key === 'type') return [j.job_type, j.job_stage].filter(Boolean).join(' ').trim().toLowerCase()
  return jobLastDateKey(j)
}

function sortJobs(list: InvoiceableJob[], sort: { key: SortKey; dir: 'asc' | 'desc' }): InvoiceableJob[] {
  const dir = sort.dir === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    const va = sortValue(a, sort.key), vb = sortValue(b, sort.key)
    // A job with no vessel/type sinks to the bottom either way — reversing the sort
    // shouldn't promote the blank rows to the top of the invoice.
    if (!va !== !vb) return va ? -1 : 1
    if (va !== vb) return va < vb ? -dir : dir
    // Same vessel (or type) → still read chronologically within the group.
    const ka = jobLastDateKey(a), kb = jobLastDateKey(b)
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
}

// 'jobs' = bill work off the job sheet · 'blank' = a client and typed lines only.
type BuildMode = 'jobs' | 'blank'

export default function ConsolidatedInvoiceBuilder({ onCreated }: { onCreated?: () => void }) {
  const [mode, setMode] = useState<BuildMode>('jobs')
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [clientId, setClientId] = useState('')
  const [billToId, setBillToId] = useState('') // '' = same as the work client
  const [month, setMonth] = useState('')       // '' = all months

  const [jobs, setJobs] = useState<InvoiceableJob[]>([])
  const [loadingJobs, setLoadingJobs] = useState(false)
  const [rates, setRates] = useState<ClientRate[]>([])
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'asc' })
  const [lines, setLines] = useState<Record<string, LineState[]>>({}) // job id → its charges
  // Draught-survey voyages in the current pool, the priced roll-up for each, and the
  // map of absorbed leg → the Final whose line bills it.
  const [voyages, setVoyages] = useState<VoyageGroup<InvoiceableJob>[]>([])
  const [voyageSeeds, setVoyageSeeds] = useState<Map<string, VoyageLineSeed>>(new Map())
  const [absorbed, setAbsorbed] = useState<Record<string, string>>({})
  const [voyageCtx, setVoyageCtx] = useState<Map<string, VoyageContext>>(new Map())
  const [extra, setExtra] = useState<DraftLine[]>([])               // manual lines + expenses

  const [currency, setCurrency] = useState<Currency>('USD')
  const [invNumber, setInvNumber] = useState('')
  const [lastInvNumber, setLastInvNumber] = useState<string | null>(null)
  // The date printed on the invoice. Left blank it falls through to the column
  // default (today) — it is never allowed to overwrite a date you did choose.
  const [issueDate, setIssueDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [attention, setAttention] = useState('')
  const [reference, setReference] = useState('')
  const [description, setDescription] = useState('')
  const [bankDetails, setBankDetails] = useState('')
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [bankAccountId, setBankAccountId] = useState('')
  // client_id → linked "pays into" bank account (client_billing.pay_to_bank_account_id).
  const [clientBankLinks, setClientBankLinks] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  const [taxes, setTaxes] = useState<TaxDraft[]>([])
  const [saving, setSaving] = useState(false)
  // Standalone (no jobs ticked): OPTIONALLY create a job for the invoice on the job
  // sheet. Off by default — this used to be unconditional, so billing a launch fee
  // silently minted a report-only job with no type and no report number, and the job
  // sheet filled up with rows nobody had worked.
  const [addJobToSheet, setAddJobToSheet] = useState(false)
  const [jobTypes, setJobTypes] = useState<string[]>([])
  const [newJobVessel, setNewJobVessel] = useState('')
  const newJobParsed = parseVesselName(newJobVessel)
  const newJobPrefix = newJobParsed.prefix ?? 'M.V.'
  const [newJobType, setNewJobType] = useState('')

  // Clients + billing defaults + the last invoice number + bank accounts, once.
  useEffect(() => {
    listBillingClients().then(setClients)
    getLatestInvoiceNumber().then(setLastInvNumber)
    listJobTypes().then(ts => setJobTypes(ts.map(t => t.name)))
    getAppSettings().then(s => { if (s) setTaxes([{ name: s.default_tax_name, rate: Number(s.default_tax_rate) }]) })
    listBankAccounts(true).then(setBankAccounts)
    listClientBilling().then(map => {
      const links: Record<string, string> = {}
      for (const [cid, b] of Object.entries(map)) if (b.pay_to_bank_account_id) links[cid] = b.pay_to_bank_account_id
      setClientBankLinks(links)
    })
  }, [])

  // True once the user manually picked an account or typed custom details — the
  // auto-select below must not overwrite their choice for the current payer.
  const bankTouched = useRef(false)
  function pickBank(id: string) {
    bankTouched.current = true
    setBankAccountId(id)
    const a = bankAccounts.find(x => x.id === id)
    if (a) setBankDetails(a.details)
  }

  // Auto-select the bank account from whoever PAYS (bill-to if set, else the work
  // client): their linked "pays into" account, falling back to the global default.
  // Re-applies on payer change; skipped while the user's own pick/typed details
  // stand — and hand-typed custom details are never overwritten, even then.
  const payerId = billToId || clientId
  const prevPayer = useRef<string | null>(null)
  useEffect(() => {
    if (bankAccounts.length === 0) return
    const payerChanged = prevPayer.current !== payerId
    prevPayer.current = payerId
    if (!payerChanged && bankTouched.current) return // late data / re-render — keep the manual choice
    if (bankTouched.current && bankAccountId === '' && bankDetails.trim()) return // hand-typed custom details
    bankTouched.current = false
    const linked = payerId ? clientBankLinks[payerId] : undefined
    const acct = (linked ? bankAccounts.find(a => a.id === linked) : undefined)
      ?? bankAccounts.find(a => a.is_default) ?? bankAccounts[0]
    if (acct) { setBankAccountId(acct.id); setBankDetails(acct.details) }
  }, [payerId, bankAccounts, clientBankLinks]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pricing one job lives in invoicing.ts (seedCharge) so the draught-survey voyage
  // roll-up prices each of its legs through exactly this code. Two spellings of "what
  // does this job cost" would drift, and the one that drifted would be the roll-up —
  // where three legs collapse into a single figure nobody can eyeball.
  const seedLine = useCallback(
    (job: InvoiceableJob, clientRates: ClientRate[], forcedRateId?: string): LineState =>
      seedCharge(job, clientRates, forcedRateId),
    [])

  // Reload the available jobs (+ rates) on client/month change. Auto-selects every
  // job — the common case is "bill all of this client's vessels for the month".
  const loadJobs = useCallback(async () => {
    // A blank invoice bills no jobs, so it loads none — nothing can be auto-selected
    // and accidentally closed behind a typed-up expense.
    if (!clientId || mode === 'blank') { setJobs([]); setLines({}); setVoyages([]); setAbsorbed({}); return }
    setLoadingJobs(true)
    const [js, rs] = await Promise.all([
      listInvoiceableJobs({ clientId, month: month || undefined }),
      listClientRates(clientId),
    ])
    setRates(rs)
    setJobs(js)
    // Only INVOICE-READY jobs are billable. report_ready ones are listed separately
    // for a one-click review — never auto-selected, or the deliberate second look
    // the invoice-ready step exists for would be skipped silently.
    const billableJs = js.filter(j => j.workflow_status === 'invoice_ready')
    const poolById = new Map(billableJs.map(j => [j.id, j]))
    const cur = (rs.find(r => r.is_active)?.currency ?? currency) as Currency

    // ── Draught-survey voyages ────────────────────────────────────────────
    // A voyage bills as ONE line on its Final; the earlier legs are absorbed into it
    // and must never appear as selectable jobs of their own. Only a CONFIDENT group
    // (every leg carrying the same voyage number) rolls up on its own — a group
    // inferred from dates is a suggestion and is handled separately, and until the
    // admin decides, its members are left as ordinary jobs.
    const groups = groupDraughtVoyages(billableJs)
    const rollUps = groups.filter(g => isRollUp(g) && g.confidence === 'confident' && isBillableAsVoyage(g))
    const seeds = new Map<string, VoyageLineSeed>()
    const absorbedMap: Record<string, string> = {}
    for (const g of rollUps) {
      const seed = seedVoyageLine({ group: g, members: poolById, rates: rs, invoiceCurrency: cur })
      seeds.set(g.key, seed)
      for (const m of g.members) if (m.id !== seed.anchorJobId) absorbedMap[m.id] = seed.anchorJobId!
    }
    setVoyages(groups)
    setVoyageSeeds(seeds)
    setAbsorbed(absorbedMap)

    // One line per billable job, EXCEPT that a voyage's legs collapse onto its Final.
    const seeded: Record<string, LineState[]> = {}
    billableJs.forEach(j => {
      if (absorbedMap[j.id]) return // billed on its Final's line, not its own
      const voyage = rollUps.find(g => g.final?.id === j.id)
      const seed = voyage ? seeds.get(voyage.key) : undefined
      seeded[j.id] = seed
        ? [{ description: seed.description, qty: seed.qty, unit_price: seed.unit_price, rate_id: null }]
        : [seedLine(j, rs)]
    })
    setLines(seeded)

    // The completeness check runs against the database with no filters, because the
    // pool above is filtered five ways and every one of them can hide a leg. Only the
    // groups we would actually roll up need it.
    fetchVoyageContext(rollUps, clientId).then(setVoyageCtx).catch(() => setVoyageCtx(new Map()))

    // Auto-add a mileage line per job when the client carries a per_km rate and the
    // job has km logged. Editable/removable; previous auto-mileage lines are dropped
    // on reload, while any manual/expense lines the user added are kept.
    //
    // A voyage's km is SUMMED across its legs and attached to the Final: the absorbed
    // legs leave the billable list, and iterating that list alone would silently drop
    // their travel — the firm eating the cost with nothing to show it happened.
    const perKm = rs.filter(r => r.is_active && r.rate_type === 'per_km')
    const mileageSources: { job: InvoiceableJob; km: number }[] = billableJs
      .filter(j => !absorbedMap[j.id])
      .map(j => {
        const voyage = rollUps.find(g => g.final?.id === j.id)
        const km = voyage
          ? voyage.members.reduce((s, m) => s + Number(poolById.get(m.id)?.billable_km ?? 0), 0)
          : Number(j.billable_km ?? 0)
        return { job: j, km }
      })
    const mileageLines: DraftLine[] = perKm.length ? mileageSources.flatMap(({ job: j, km }) => {
      if (!km || km <= 0) return []
      const rate = pickRate(perKm, j)
      if (!rate) return []
      const label = j.vessel_name ? withVesselPrefix(j.vessel_name, j.vessel_type) : (j.report_number ?? 'Survey')
      return [{ ...blankLine(false), description: `${label} — Mileage\n${km} km`, qty: km, unit_price: Number(rate.rate), auto_mileage: true }]
    }) : []
    setExtra(prev => [...prev.filter(l => !l.auto_mileage), ...mileageLines])
    const firstRate = rs.find(r => r.is_active)
    if (firstRate) setCurrency(firstRate.currency)
    setLoadingJobs(false)
  }, [clientId, month, mode, seedLine]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadJobs() }, [loadJobs])

  // Switching to a blank invoice drops the job pool's auto-mileage lines (they price
  // jobs that are no longer being billed) and opens with one empty line to type into.
  function switchMode(m: BuildMode) {
    setMode(m)
    if (m !== 'blank') return
    setExtra(prev => {
      const kept = prev.filter(l => !l.auto_mileage)
      return kept.length ? kept : [blankLine(false)]
    })
  }

  // Billable = invoice-ready. Awaiting = submitted but not yet reviewed; shown below
  // the billable list with a one-click "Mark invoice ready" so a forgotten flip
  // never means hunting through the jobs list.
  // Absorbed legs are deliberately absent: they are billed on their Final's line, and
  // showing them here as tickable jobs is exactly the three-line invoice this exists
  // to prevent. The Final's row lists them instead.
  const billable = useMemo(
    () => sortJobs(jobs.filter(j => j.workflow_status === 'invoice_ready' && !absorbed[j.id]), sort),
    [jobs, sort, absorbed])
  const awaiting = useMemo(() => sortJobs(jobs.filter(j => j.workflow_status === 'report_ready'), sort), [jobs, sort])

  const [markingId, setMarkingId] = useState<string | null>(null)
  async function markReady(job: InvoiceableJob) {
    setMarkingId(job.id)
    const res = await markJobInvoiceReady(job.id)
    setMarkingId(null)
    if (res.error) { toast.error(res.error); return }
    toast.success(`${job.vessel_name ?? job.report_number ?? 'Job'} is now invoice ready`)
    loadJobs()
  }

  const toggle = (job: InvoiceableJob) => setLines(prev => {
    const next = { ...prev }
    if (next[job.id]) delete next[job.id]
    else next[job.id] = [seedLine(job, rates)]
    return next
  })
  const allSelected = billable.length > 0 && billable.every(j => lines[j.id])
  const toggleAll = () => setLines(prev => {
    if (billable.every(j => prev[j.id])) return {}
    const all: Record<string, LineState[]> = {}
    billable.forEach(j => { all[j.id] = prev[j.id] ?? [seedLine(j, rates)] })
    return all
  })
  const setLine = (id: string, i: number, patch: Partial<LineState>) =>
    setLines(prev => ({ ...prev, [id]: (prev[id] ?? []).map((l, k) => k === i ? { ...l, ...patch } : l) }))
  // Re-seed a whole line from a different rate (qty, price and description all follow
  // the rate, so this replaces the line rather than patching its rate_id).
  const setLineRate = (job: InvoiceableJob, i: number, rateId: string) =>
    setLines(prev => ({ ...prev, [job.id]: (prev[job.id] ?? []).map((l, k) => k === i ? seedLine(job, rates, rateId) : l) }))
  // Removing the last charge deselects the job outright — a selected job with no
  // lines would still read as "selected" while billing nothing.
  const removeLine = (id: string, i: number) => setLines(prev => {
    const rest = (prev[id] ?? []).filter((_, k) => k !== i)
    const next = { ...prev }
    if (rest.length) next[id] = rest; else delete next[id]
    return next
  })
  // A second charge on the same job defaults to the first rate this job isn't already
  // billing — on a UHT job that turns "per Cargo Hold" into "per Hatch Cover" in one
  // click. Falls back to a blank line to price by hand when every rate is used.
  const addLine = (job: InvoiceableJob) => setLines(prev => {
    const used = new Set((prev[job.id] ?? []).map(l => l.rate_id).filter(Boolean))
    const next = rates.find(r => r.is_active && r.rate_type !== 'per_km' && !used.has(r.id))
    return { ...prev, [job.id]: [...(prev[job.id] ?? []), seedLine(job, rates, next?.id ?? '')] }
  })
  // Same convention as the jobs tracker: clicking the active key flips the direction,
  // a new key starts ascending (oldest first / A–Z).
  const toggleSort = (key: SortKey) =>
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })

  // Ticked jobs, in the order the picker shows them (so the sort above is also the
  // invoice's line order), each contributing all of its charges.
  const selectedJobs = billable.filter(j => lines[j.id]?.length)
  const orderedLines = selectedJobs.flatMap(j => lines[j.id].map(l => ({ job: j, ...l })))
  const allDrafts = [
    ...orderedLines.map(l => ({ description: l.description, qty: l.qty, unit_price: l.unit_price })),
    ...extra.map(l => ({ description: l.description, qty: l.qty, unit_price: l.unit_price })),
  ]
  const lineCount = orderedLines.length + extra.length
  const totals = computeTotals(allDrafts, taxes)
  const clientName = clients.find(c => c.id === clientId)?.name ?? ''
  const billToName = clients.find(c => c.id === billToId)?.name ?? ''

  // Every rate-dependent display goes through this, so the note, the hours hint and
  // the currency check can never describe a different rate from the one pricing the
  // line — which is how "Rate note: Discharge Draught" ended up under an Initial
  // survey. A line the user has picked a rate for wins over the automatic match.
  const billableRates = rates.filter(r => r.is_active && r.rate_type !== 'per_km')
  // ls is the charge being displayed; omitted for an unticked job, which shows what
  // the automatic match WOULD price it at.
  function rateForLine(job: InvoiceableJob, ls?: LineState): ClientRate | null {
    if (ls) return ls.rate_id ? billableRates.find(r => r.id === ls.rate_id) ?? null : null
    return pickRate(billableRates, job)
  }

  // The note saved against the rate pricing this line (e.g. initial/final fees).
  function rateNoteFor(job: InvoiceableJob, ls?: LineState): string | null {
    return rateForLine(job, ls)?.notes ?? null
  }

  // When the matched rate is hourly, show that the line's qty came from the job's
  // billable hours (checklist total or labour ledger) — so it's clear the chain is
  // linked. Day-billed jobs (migration 148) say so instead, and never claim hours.
  function hoursHintFor(job: InvoiceableJob, ls?: LineState): string | null {
    const rate = rateForLine(job, ls)
    if (rate?.rate_type === 'per_unit') {
      const unit = rate.unit_label || 'unit'
      const perDayUnit = /^days?$/i.test(unit.trim())
      // A per-unit rate whose unit IS the day predates the real day rate (migration
      // 169); count its days the same way so the two never disagree.
      const count = job.billable_quantity ?? (perDayUnit ? billedDays(job) : null)
      if (!count || count <= 0) return `Per-${unit} rate — no count on this job yet; enter the qty manually.`
      return `${count} ${unit} × ${money(Number(rate.rate), rate.currency)}/${unit}`
    }
    // A day rate (migration 169) counts the job's own dates, both ends — so say which
    // dates produced the number, and warn when the job has none to count.
    if (rate?.rate_type === 'daily') {
      const days = billedDays(job)
      const per = `${days} day${days === 1 ? '' : 's'} × ${money(Number(rate.rate), rate.currency)}/day`
      if (!job.day_span) return `${per} — this job has no dates set, so the count is a fallback; check the qty.`
      const from = job.scheduled_date ? formatDate(job.scheduled_date) : null
      const to = job.end_date && job.end_date !== job.scheduled_date ? formatDate(job.end_date) : null
      return to ? `${from} – ${to} = ${per}` : `${per} (${from})`
    }
    if (rate?.rate_type !== 'hourly') return null
    // An hourly rate cannot price a day count, so the qty is left at 1 deliberately.
    if (job.labour_unit === 'days') {
      const worked = job.billable_days && job.billable_days > 0 ? `${job.billable_days} day${job.billable_days === 1 ? '' : 's'} worked` : 'No days logged yet'
      return `Billed by the day — ${worked}. This client's rate is hourly, so the unit price is left at 0 — enter the day rate by hand, or add a Day rate for this client.`
    }
    if (!job.billable_hours || job.billable_hours <= 0) return 'Hourly rate — no billable hours found on this job yet; enter the qty (hours) manually.'
    return `${job.billable_hours} billable hrs × ${money(Number(rate.rate), rate.currency)}/hr`
  }

  async function create() {
    if (!clientId) { toast.error('Choose a client'); return }
    if (lineCount === 0) { toast.error(mode === 'blank' ? 'Add at least one line' : 'Add at least one job, line or expense'); return }
    // Money-safety: every line is summed under one invoice currency, so block creating
    // an invoice where a selected job's rate is in a DIFFERENT currency (no conversion).
    const active = rates.filter(r => r.is_active)
    const mismatch = orderedLines.find(l => {
      const rate = rateForLine(l.job, l)
      return rate && rate.currency !== currency
    })
    if (mismatch) {
      const rate = rateForLine(mismatch.job, mismatch)
      toast.error(`${mismatch.job.job_type ?? 'A job'} is rated in ${rate?.currency}, but this invoice is ${currency}. Match the currency (or remove that job) before billing.`)
      return
    }
    // Same check for the auto-mileage lines, which are priced from a per_km rate
    // that lives outside orderedLines and was previously never currency-checked.
    if (extra.some(l => l.auto_mileage)) {
      const kmMismatch = active.find(r => r.rate_type === 'per_km' && r.currency !== currency)
      if (kmMismatch) {
        toast.error(`Mileage is rated in ${kmMismatch.currency}, but this invoice is ${currency}. Match the currency (or remove the mileage line) before billing.`)
        return
      }
    }
    // ── Voyage roll-ups: refuse, never warn ───────────────────────────────
    // Three legs collapsed into one figure destroys the reader's ability to notice
    // that one of them priced at zero, or came from the wrong rate, or was quietly
    // left out. So every one of those is a hard block — and the leg would still be
    // closed and locked behind the wrong number.
    const selectedIds = new Set(selectedJobs.map(j => j.id))
    for (const g of voyages) {
      const seed = voyageSeeds.get(g.key)
      if (!seed || !g.final || !selectedIds.has(g.final.id)) continue
      const block = seed.blocks[0]
      if (block) { toast.error(`${describeGrouping(g)}: ${describeBlock(block)}`); return }
      const problem = voyageCtx.get(g.key)?.problems[0]
      if (problem) { toast.error(`${describeGrouping(g)}: ${describeContextProblem(problem)}`); return }
      // The line's job must BE the Final: it is what carries the report number the PDF
      // prints and what every absorbed leg points at. If those ever diverge, the client
      // gets one survey's report reference against another survey's money.
      if (seed.anchorJobId !== g.final.id) {
        toast.error(`${describeGrouping(g)}: the voyage line is not anchored on its final survey. Reload and try again.`)
        return
      }
    }
    // Only the absorbed legs of voyages actually being billed.
    const absorbedForInvoice: Record<string, string> = {}
    for (const [legId, finalId] of Object.entries(absorbed)) {
      if (selectedIds.has(finalId)) absorbedForInvoice[legId] = finalId
    }
    // The per-leg arithmetic goes on the invoice's INTERNAL notes: the client's line
    // deliberately shows one figure, and a year from now somebody will ask how 1,050
    // was arrived at.
    const rollUpNotes = voyages
      .filter(g => g.final && selectedIds.has(g.final.id) && voyageSeeds.get(g.key)?.breakdown.length! > 1)
      .map(g => breakdownNote(voyageSeeds.get(g.key)!, g.voyage))
      .join('\n\n')

    setSaving(true)
    const res = await createConsolidatedInvoice({
      client_id: clientId,
      bill_to_client_id: billToId || null,
      invoice_number: invNumber.trim() || null,
      issue_date: issueDate || null,
      currency, due_date: dueDate || null,
      notes: [notes || null, rollUpNotes || null].filter(Boolean).join('\n\n') || null,
      description: description || null, reference: reference || null,
      attention: attention || null, bank_details: bankDetails || null,
      lines: [
        ...orderedLines.map(l => ({ job_id: l.job.id, description: l.description, qty: l.qty, unit_price: l.unit_price, is_expense: false })),
        ...extra.map(l => ({ job_id: null, description: l.description, qty: l.qty, unit_price: l.unit_price, is_expense: l.is_expense, receipt_path: l.receipt_path })),
      ],
      taxes: taxes.filter(t => t.name.trim()),
      absorbed: absorbedForInvoice,
      // No vessels ticked AND you asked for one → create a job for this invoice on
      // the job sheet. Opt-in: an invoice stands on its own everywhere it's read.
      // A typed "M.T."/"MT"/"M/T" here is captured too, and the name is stored bare —
      // matching every other creation path. (This route still writes the job row
      // directly rather than via createDraftJob; that seam bypass is out of scope.)
      new_job: selectedJobs.length === 0 && addJobToSheet ? {
        title: newJobParsed.name
          ? `${newJobPrefix} ${newJobParsed.name}`
          : `${clientName || 'Client'} — invoice`,
        vessel_name: newJobParsed.name || null,
        vessel_type: newJobPrefix,
        job_type: newJobType || null,
      } : null,
    })
    setSaving(false)
    if (res.error) { toast.error(res.error); return }
    const v = selectedJobs.length
    toast.success(v > 0 ? `Invoice created for ${v} vessel${v === 1 ? '' : 's'}`
      : addJobToSheet ? 'Invoice created — a job was added to the job sheet' : 'Invoice created')
    setDescription(''); setReference(''); setAttention(''); setNotes(''); setIssueDate(''); setDueDate(''); setInvNumber(''); setExtra([]); setNewJobVessel(''); setNewJobType(''); setAddJobToSheet(false)
    getLatestInvoiceNumber().then(setLastInvNumber)
    await loadJobs() // billed jobs drop out of the list
    onCreated?.()
  }

  const cell = 'input-base py-1 text-sm'

  return (
    <div className="space-y-4">
      {/* 1 — Who & when */}
      <div className="card p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium text-gray-900 flex items-center gap-2">
            <Users className="h-4 w-4 text-brand-500" /> {mode === 'blank' ? 'Who to bill' : 'Whose jobs to bill'}
          </h3>
          <SegmentedControl<BuildMode>
            value={mode}
            onChange={switchMode}
            size="sm"
            ariaLabel="What kind of invoice"
            options={[{ value: 'jobs', label: 'Bill jobs' }, { value: 'blank', label: 'Blank invoice' }]}
          />
        </div>
        {mode === 'blank' && (
          <p className="text-xs text-gray-400">
            Pick a client and type the lines. No jobs are billed and none is created.
          </p>
        )}
        <div className={`grid grid-cols-1 gap-3 ${mode === 'blank' ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
          <div>
            <label className="text-[11px] text-gray-400">{mode === 'blank' ? 'Client' : 'Client (vessels)'}</label>
            <select value={clientId} onChange={e => setClientId(e.target.value)} className={cell}>
              <option value="">— Select a client —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {mode === 'jobs' && (
            <div>
              <label className="text-[11px] text-gray-400">Month (optional)</label>
              <input type="month" value={month} onChange={e => setMonth(e.target.value)} className={cell} />
            </div>
          )}
          <div>
            <label className="text-[11px] text-gray-400">Bill to (who pays)</label>
            <select value={billToId} onChange={e => setBillToId(e.target.value)} className={cell} disabled={!clientId}>
              <option value="">{clientName ? `Same as ${clientName}` : 'Same as client'}</option>
              {clients.filter(c => c.id !== clientId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        {billToId && billToName && clientName && (
          <p className="text-[11px] text-brand-700 bg-brand-50/70 rounded-md px-2.5 py-1.5">
            Addressed to <strong>{billToName}</strong> for <strong>{clientName}</strong>&apos;s vessels.
          </p>
        )}
      </div>

      {/* 2 — Pick the vessels/jobs (not shown for a blank invoice) */}
      {clientId && mode === 'jobs' && (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 border-b border-gray-100 bg-gray-50/60">
            <button onClick={toggleAll} disabled={billable.length === 0} className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900 disabled:opacity-40">
              {allSelected ? <CheckSquare className="h-4 w-4 text-brand-600" /> : <Square className="h-4 w-4 text-gray-400" />}
              Select all
            </button>
            {/* Ordering the pool also orders the invoice lines — see SORTS above. */}
            {jobs.length > 1 && (
              <div className="flex items-center gap-1" role="group" aria-label="Sort jobs">
                <span className="text-[11px] text-gray-400 mr-0.5">Sort</span>
                {SORTS.map(s => {
                  const active = sort.key === s.key
                  return (
                    <button key={s.key} onClick={() => toggleSort(s.key)} aria-pressed={active}
                      title={active ? (sort.dir === 'asc' ? 'Ascending — click to reverse' : 'Descending — click to reverse') : `Sort by ${s.label.toLowerCase()}`}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${active ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'}`}>
                      {s.label}
                      {active
                        ? <span className="text-[10px]">{sort.dir === 'asc' ? '▲' : '▼'}</span>
                        : <ArrowUpDown className="h-3 w-3 opacity-30" />}
                    </button>
                  )
                })}
              </div>
            )}
            <span className="ml-auto text-xs text-gray-400 tnum">
              {selectedJobs.length} of {billable.length} selected
              {orderedLines.length > selectedJobs.length && ` · ${orderedLines.length} lines`}
            </span>
          </div>

          {loadingJobs ? (
            <div className="p-4 space-y-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-10 w-full" />)}</div>
          ) : jobs.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-400">
              No jobs ready to invoice for {clientName}{month ? ` in ${month}` : ''}. Jobs appear here once they&apos;ve been submitted and aren&apos;t already on an invoice.
            </p>
          ) : (
            <div className="divide-y divide-gray-50">
              {billable.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-gray-400">
                  Nothing marked invoice ready yet — review the jobs below and mark the ones you want to bill.
                </p>
              )}
              {billable.map(j => {
                const jobLines = lines[j.id]
                const sel = !!jobLines?.length
                const note = sel ? null : rateNoteFor(j)
                return (
                  <div key={j.id} className={sel ? 'px-4 py-3 bg-brand-50/30' : 'px-4 py-3'}>
                    <div className="flex items-start gap-3">
                      <button onClick={() => toggle(j)} className="mt-0.5 shrink-0">
                        {sel ? <CheckSquare className="h-4 w-4 text-brand-600" /> : <Square className="h-4 w-4 text-gray-300 hover:text-gray-400" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-400">
                          <span className="tnum font-medium text-gray-600">{j.report_number ?? 'no report #'}</span>
                          {/* Stage and cargo type qualify the job type. Two Draught
                              Surveys on one vessel are indistinguishable without the
                              stage, which is exactly when you need to tell them apart. */}
                          {j.job_type && <span>· {j.job_type}</span>}
                          {j.job_stage && <span className="text-gray-500 font-medium">({j.job_stage})</span>}
                          {j.cargo_type && <span className="text-gray-400">· {j.cargo_type}</span>}
                          {jobLastDate(j) && <span>· {formatDate(jobLastDate(j))}{jobSpansDays(j) && <span className="text-gray-300"> (from {formatDate(j.scheduled_date)})</span>}</span>}
                          {/* Day-billed (migration 148) — flagged here so the line is never priced as hours. */}
                          {j.labour_unit === 'days' && <span className="px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">Billed by the day</span>}
                        </div>
                        {/* A voyage roll-up: this Final's line bills the whole voyage, so
                            show WHAT it is billing and what each leg contributed. The
                            client sees one figure; the person pressing Create must be able
                            to check 350 + 350 + 350 = 1050 before they do. */}
                        {(() => {
                          const g = voyages.find(v => v.final?.id === j.id && voyageSeeds.has(v.key))
                          const seed = g ? voyageSeeds.get(g.key) : undefined
                          if (!g || !seed || seed.breakdown.length < 2) return null
                          const ctx = voyageCtx.get(g.key)
                          const blocked = seed.blocks.length > 0 || (ctx?.problems.length ?? 0) > 0
                          return (
                            <div className={`mt-1.5 rounded-lg border px-2.5 py-2 ${blocked ? 'border-red-200 bg-red-50/60' : 'border-brand-200 bg-brand-50/40'}`}>
                              <p className="text-[11px] font-medium text-gray-700">
                                {describeGrouping(g)} — billed as one survey
                              </p>
                              <ul className="mt-1 space-y-0.5">
                                {seed.breakdown.map(c => (
                                  <li key={c.job_id} className="flex items-baseline gap-2 text-[11px] text-gray-500">
                                    <span className="w-16 shrink-0">{c.stage}</span>
                                    <span className="text-gray-400 truncate flex-1">{c.report_number ?? 'no report #'}</span>
                                    <span className="tnum">{money(c.amount, currency)}</span>
                                  </li>
                                ))}
                              </ul>
                              <p className="mt-1 pt-1 border-t border-gray-200/70 flex items-baseline gap-2 text-[11px] font-medium text-gray-700">
                                <span className="flex-1">Total on this line</span>
                                <span className="tnum">{money(seed.total, currency)}</span>
                              </p>
                              {seed.blocks.map((b, bi) => (
                                <p key={bi} className="mt-1 text-[11px] text-red-700">{describeBlock(b)}</p>
                              ))}
                              {(ctx?.problems ?? []).map((p, pi) => (
                                <p key={pi} className="mt-1 text-[11px] text-red-700">{describeContextProblem(p)}</p>
                              ))}
                            </div>
                          )
                        })()}
                        {sel ? (
                          <>
                          {/* One block per charge. A job usually has one, but it can carry
                              several — UHT bills per hatch cover AND per cargo hold — so
                              each gets its own rate, qty and price. */}
                          {jobLines.map((ls, i) => {
                            const lineNote = rateNoteFor(j, ls)
                            const lineHint = hoursHintFor(j, ls)
                            return (
                              <div key={i} className={i > 0 ? 'mt-2 pt-2 border-t border-dashed border-gray-200' : ''}>
                                {/* Which rate is pricing this line, and the way to change it.
                                    Without this the match was invisible: a client with an
                                    Initial and a Discharge draught rate got whichever sorted
                                    first, with no clue in the UI. Re-seeds the whole line, so
                                    pick the rate before editing the description by hand. */}
                                {billableRates.length > 0 && (
                                  <div className="mt-1.5 flex items-center gap-2">
                                    <span className="text-[11px] text-gray-400 shrink-0">{i === 0 ? 'Rate' : `Charge ${i + 1}`}</span>
                                    <select
                                      value={ls.rate_id ?? ''}
                                      onChange={e => setLineRate(j, i, e.target.value)}
                                      className="input-base py-1 text-xs w-auto max-w-full"
                                    >
                                      <option value="">No rate — enter the price by hand</option>
                                      {billableRates.map(r => (
                                        <option key={r.id} value={r.id}>
                                          {[r.job_type || 'Any job type', r.job_stage].filter(Boolean).join(' · ')}
                                          {' — '}{money(Number(r.rate), r.currency)}
                                          {r.rate_type === 'hourly' ? '/hr' : r.rate_type === 'daily' ? '/day' : r.rate_type === 'per_unit' ? `/${r.unit_label || 'unit'}` : ''}
                                          {r.notes ? ` (${r.notes})` : ''}
                                        </option>
                                      ))}
                                    </select>
                                    {jobLines.length > 1 && (
                                      <button onClick={() => removeLine(j.id, i)} title="Remove this charge"
                                        className="ml-auto shrink-0 text-gray-300 hover:text-red-600">
                                        <X className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                  </div>
                                )}
                                <div className="mt-1.5 grid grid-cols-[1fr_3.5rem_6rem_5rem] gap-2 items-start">
                                  <textarea rows={2} value={ls.description} onChange={e => setLine(j.id, i, { description: e.target.value })} className={`${cell} resize-y leading-snug`} />
                                  <input type="number" min={0} step="0.5" value={ls.qty} onChange={e => setLine(j.id, i, { qty: Number(e.target.value) })} className={`${cell} text-right`} />
                                  <input type="number" min={0} step="0.01" value={ls.unit_price} onChange={e => setLine(j.id, i, { unit_price: Number(e.target.value) })} className={`${cell} text-right`} />
                                  <span className="text-sm text-gray-700 text-right tnum pt-1.5">{((Number(ls.qty) || 0) * (Number(ls.unit_price) || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                                {lineHint && <p className="text-[11px] text-brand-700 mt-1">{lineHint}</p>}
                                {lineNote && <p className="text-[11px] text-amber-700 mt-1">Rate note: {lineNote}</p>}
                              </div>
                            )
                          })}
                          <button onClick={() => addLine(j)} className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-brand-700 hover:text-brand-800">
                            <Plus className="h-3 w-3" /> Add another charge for this job
                          </button>
                          </>
                        ) : (
                          <p className="text-sm text-gray-800 mt-0.5">{j.vessel_name ? withVesselPrefix(j.vessel_name, j.vessel_type) : 'No vessel'}</p>
                        )}
                        {note && <p className="text-[11px] text-amber-700 mt-1">Rate note: {note}</p>}
                      </div>
                    </div>
                  </div>
                )
              })}

              {/* Submitted but not yet reviewed. Deliberately NOT selectable — one
                  look confirms the report is finished, then it joins the list above. */}
              {awaiting.length > 0 && (
                <div className="bg-amber-50/40">
                  <p className="px-4 pt-3 pb-1 text-xs font-medium text-amber-800">
                    Awaiting your review · {awaiting.length}
                    <span className="font-normal text-amber-700/80"> — submitted, but not marked invoice ready yet</span>
                  </p>
                  {awaiting.map(j => (
                    <div key={j.id} className="px-4 py-3 flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-400">
                          <span className="tnum font-medium text-gray-600">{j.report_number ?? 'no report #'}</span>
                          {j.job_type && <span>· {j.job_type}</span>}
                          {j.job_stage && <span className="text-gray-500 font-medium">({j.job_stage})</span>}
                          {j.cargo_type && <span className="text-gray-400">· {j.cargo_type}</span>}
                          {jobLastDate(j) && <span>· {formatDate(jobLastDate(j))}{jobSpansDays(j) && <span className="text-gray-300"> (from {formatDate(j.scheduled_date)})</span>}</span>}
                        </div>
                        <p className="text-sm text-gray-800 mt-0.5">{j.vessel_name ? withVesselPrefix(j.vessel_name, j.vessel_type) : 'No vessel'}</p>
                      </div>
                      <button onClick={() => markReady(j)} disabled={markingId === j.id}
                        className="btn-secondary shrink-0 py-1 px-2.5 text-xs disabled:opacity-50">
                        {markingId === j.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckSquare className="h-3.5 w-3.5" />}
                        Mark invoice ready
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {jobs.length > 0 && (
            <div className="grid grid-cols-[1fr_3.5rem_6rem_5rem] gap-2 px-4 py-1.5 border-t border-gray-100 text-[11px] text-gray-400">
              <span>Selected lines · Description</span><span className="text-right">Qty</span><span className="text-right">Unit price</span><span className="text-right">Amount</span>
            </div>
          )}
        </div>
      )}

      {/* 2b — Expenses & extra lines (works standalone, with no jobs ticked) */}
      {clientId && (
        <div className="card p-5 space-y-3">
          <div>
            <h3 className="font-medium text-gray-900 flex items-center gap-2">
              <Paperclip className="h-4 w-4 text-brand-500" /> {mode === 'blank' ? 'Invoice lines' : 'Expenses & extra lines'}
            </h3>
            <p className="text-xs text-gray-400">
              {mode === 'blank'
                ? 'Type each charge, or tick "Reimbursable expense" to attach the vendor receipt and its value.'
                : 'Reimbursable expenses (e.g. a launch) with the vendor receipt + value, or any extra line. Leave the vessels above unticked to bill without a job.'}
            </p>
          </div>
          <LineItemsEditor lines={extra} setLines={setExtra} currency={currency} />
        </div>
      )}

      {/* 3 — Invoice details */}
      {clientId && lineCount > 0 && (
        <div className="card p-5 space-y-3">
          <h3 className="font-medium text-gray-900 flex items-center gap-2"><Receipt className="h-4 w-4 text-brand-500" /> Invoice details</h3>

          {/* Opt-in, and only worth offering when no real job is being billed. Ticking
              it adds a closed report-only job to the job sheet for this invoice —
              useful when the work did happen on a vessel and you want it on the
              sheet; pointless for a launch fee or a reimbursed expense. */}
          {selectedJobs.length === 0 && (
            <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 space-y-2">
              <label className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={addJobToSheet} onChange={e => setAddJobToSheet(e.target.checked)} className="mt-0.5" />
                <span>
                  Also add this invoice to the job sheet
                  <span className="block text-[11px] text-gray-400">Creates one closed job for it. Leave off for an expense or a one-off charge.</span>
                </span>
              </label>
              {addJobToSheet && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-gray-400">Vessel name (optional)</label>
                    <input value={newJobVessel} onChange={e => setNewJobVessel(e.target.value)} placeholder="e.g. Channel Pearl" className={cell} />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-400">Job type (optional)</label>
                    <select value={newJobType} onChange={e => setNewJobType(e.target.value)} className={cell}>
                      <option value="">—</option>
                      {jobTypes.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-[11px] text-gray-400">Invoice no.</label>
              <input value={invNumber} onChange={e => setInvNumber(e.target.value)} placeholder="auto (YY-MM-NNN)" className={`${cell} tnum`} />
              <p className="text-[11px] text-gray-400 mt-0.5">{lastInvNumber ? <>Last: <span className="tnum">{lastInvNumber}</span> · blank = auto</> : 'Leave blank to auto-number'}</p>
            </div>
            <div>
              {/* The date printed on the invoice. Before this existed the invoice was
                  always stamped with the day it was created, so back-dating a month's
                  billing was impossible. */}
              <label className="text-[11px] text-gray-400">Invoice date</label>
              <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} className={cell} />
              <p className="text-[11px] text-gray-400 mt-0.5">Blank = today</p>
            </div>
            <div>
              <label className="text-[11px] text-gray-400">Currency</label>
              <select value={currency} onChange={e => setCurrency(e.target.value as Currency)} className={cell}>{CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}</select>
            </div>
            <div>
              <label className="text-[11px] text-gray-400">Due date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={cell} />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-gray-400">Your ref / PO no. (optional)</label>
            <input value={reference} onChange={e => setReference(e.target.value)} placeholder="e.g. PO 4500284686" className={cell} />
          </div>
          <div>
            <label className="text-[11px] text-gray-400">Attention (optional)</label>
            <input value={attention} onChange={e => setAttention(e.target.value)} placeholder="e.g. Accounts Payable" className={cell} />
          </div>
          <div>
            <label className="text-[11px] text-gray-400">Description / narrative (optional)</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder={'e.g. Monthly survey attendance — ' + (clientName || 'client') + ' vessels'} className="input-base text-sm resize-y" />
          </div>

          {/* Taxes */}
          <TaxEditor taxes={taxes} setTaxes={setTaxes} lines={allDrafts} />

          {/* Totals */}
          <TotalsSummary lines={allDrafts} taxes={taxes} currency={currency} />

          <BankAccountPicker
            bankAccounts={bankAccounts}
            bankAccountId={bankAccountId}
            bankDetails={bankDetails}
            currency={currency}
            onPickAccount={pickBank}
            onDetailsChange={d => { bankTouched.current = true; setBankDetails(d); setBankAccountId('') }}
            linkedAccountId={payerId ? clientBankLinks[payerId] : null}
            linkedPartyName={billToId ? billToName : clientName}
          />
          <div>
            <label className="text-[11px] text-gray-400">Internal notes (not on the invoice)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="input-base text-sm resize-none" />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button onClick={create} disabled={saving} className="btn-primary py-2 px-4 text-sm">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
              Create invoice{selectedJobs.length > 0 ? ` (${selectedJobs.length} ${selectedJobs.length === 1 ? 'vessel' : 'vessels'})` : ''}
            </button>
            <span className="text-sm text-gray-400 tnum">{money(totals.total, currency)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
