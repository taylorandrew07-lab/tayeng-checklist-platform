// P&I cases — the whole data layer.
//
// A case is NOT a job. It has its own tables (migration 212), its own page, and no
// contact with the job pipeline, TE invoicing, the calendar or the labour report. We act
// as correspondent; Taylor Engineering is one contractor among several whose time and
// costs are recorded here, and the invoice that eventually goes out is raised outside
// this app entirely.
//
// Two consequences shape everything below:
//   * An ATTENDEE is an app user OR a name typed in. External contractors are
//     first-class, which the old job-shaped model could not express at all.
//   * Money is per ITEM. The rate belongs to the work, not the person: hourly, daily or
//     a flat fee, in its own currency. charge_amount is GENERATED in the database, so an
//     export can never drift from what is on screen.
//
// Everything here is admin-only at the database. Every row carries a rate, and RLS
// cannot hide a column — a surveyor who could read an attendance would read the rate
// paid to every contractor on the matter.

import { createClient } from '@/lib/supabase/client'
import { sanitizeStorageName } from '@/lib/utils'
import { todayKey } from '@/lib/cargo/voyageDate'

// USD first: it is the primary currency for P&I work. Imported rather than redeclared —
// a second local list is how the two copies in this codebase came to disagree.
export { CURRENCIES } from '@/lib/jobs/tracker'

export const CASE_BUCKET = 'case-documents'

export type CaseStatus = 'open' | 'on_hold' | 'concluded'
export type RateType = 'hourly' | 'daily' | 'fixed'

/** One badge per domain — never inline a new colour map (DESIGN.md). */
export const CASE_STATUS: Record<CaseStatus, { label: string; pill: string; dot: string }> = {
  open:      { label: 'Open',      pill: 'bg-sky-100 text-sky-700',     dot: 'bg-sky-500' },
  on_hold:   { label: 'On hold',   pill: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  concluded: { label: 'Concluded', pill: 'bg-slate-200 text-slate-600', dot: 'bg-slate-500' },
}
export const CASE_STATUS_ORDER: CaseStatus[] = ['open', 'on_hold', 'concluded']

export const RATE_TYPE: Record<RateType, string> = {
  hourly: 'Hourly',
  daily: 'Daily',
  fixed: 'Fixed fee',
}

/** Suggestions only — the field stays free text. A club's matters vary too much to
 *  enumerate, and a closed list would be wrong the first time something new came in. */
export const CASE_TYPE_SUGGESTIONS = [
  'Collision', 'Allision', 'Grounding', 'Medical', 'Personal injury',
  'Cargo damage', 'Pollution', 'Salvage', 'Stowaway', 'Wreck removal',
]

export interface CaseRow {
  id: string
  /** LEGACY typed name (mig 217). Never ask for this — ask caseTitle(row), which
   *  builds the name from the parts and reads this only when there are none. */
  title: string | null
  case_type: string | null
  our_vessel: string | null
  our_vessel_type: string | null
  other_party: string | null
  case_ref: string | null
  principal: string | null
  status: CaseStatus
  opened_on: string
  closed_on: string | null
  notes: string | null
  /** Standing hourly rate per kind of work on this case, keyed by the kind LOWERCASED —
   *  {"phone call": {rate: 120, currency: "USD"}}. It is what lets a one-tap entry price
   *  itself; it never blocks one, and a line can always be edited afterwards. */
  rate_defaults: Record<string, { rate?: number | string; currency?: string }>
  created_at: string
}

/** The standing rate for a kind of work on this case, or null if nobody has said. */
export function rateDefaultFor(
  kase: Pick<CaseRow, 'rate_defaults'> | null | undefined, kind: string,
): { rate: number; currency: string } | null {
  const d = kase?.rate_defaults?.[kind.trim().toLowerCase()]
  const rate = Number(d?.rate)
  if (!d || !Number.isFinite(rate) || rate <= 0) return null
  return { rate, currency: d.currency || 'USD' }
}

export interface CaseAttendance {
  id: string
  case_id: string
  attendee_profile_id: string | null
  attendee_name: string | null
  /** The app user's name when there is one, otherwise the typed name. */
  attendee_label: string
  attended_on: string
  /** Trinidad wall-clock, when known. Set by the quick blocks, which work backwards from
   *  the tap; NULL on an attendance entered as a plain duration. minutes is always the
   *  authority for a total, never the clock arithmetic. */
  start_time: string | null
  end_time: string | null
  minutes: number
  description: string | null
  location: string | null
  note: string | null
  rate_type: RateType
  rate_amount: number | null
  days: number | null
  currency: string
  /** GENERATED in the database. Null = nobody has priced this yet. */
  charge_amount: number | null
  claim_id: string | null
  claim_no: number | null
  document_count: number
}

export interface CaseCharge {
  id: string
  case_id: string
  /** Free text since mig 219 — what it IS, as typed. Show it with chargeKindLabel(),
   *  which also covers the four keys rows written before then still hold. */
  kind: string
  description: string
  payee: string | null
  incurred_on: string
  /** Whole minutes when this fee IS time — a call, an email — and null for a purchase.
   *  The rate is then per HOUR, and the division happens in the database, once. */
  minutes: number | null
  /** Trinidad wall-clock, set by the quick buttons, which work backwards from the tap. */
  start_time: string | null
  end_time: string | null
  qty: number
  unit_amount: number
  currency: string
  /** GENERATED in the database (mig 220). Never re-multiplied on a screen. */
  amount: number
  /** Who entered it. On a timed fee that is who made the call or wrote the email, which
   *  is the one thing a bare "Phone call" line could not tell you. */
  creator_label: string | null
  claim_id: string | null
  claim_no: number | null
  document_count: number
}

export interface CaseClaim {
  id: string
  case_id: string
  claim_no: number
  currency: string
  cutoff_on: string
  total: number
  item_count: number
  reference: string | null
  invoiced_on: string | null
  note: string | null
  created_at: string
}

export interface CaseDocument {
  id: string
  case_id: string
  attendance_id: string | null
  charge_id: string | null
  name: string
  category: string | null
  storage_path: string
  content_type: string | null
  size_bytes: number | null
  created_at: string
}

const num = (v: unknown, d = 0) => (v == null ? d : Number(v))
const clean = (v: string | null | undefined) => {
  const t = (v ?? '').trim()
  return t === '' ? null : t
}

// ── Cases ───────────────────────────────────────────────────────────────────

const CASE_COLS =
  'id, title, case_type, our_vessel, our_vessel_type, other_party, case_ref, principal, ' +
  'status, opened_on, closed_on, notes, rate_defaults, created_at'

const asCase = (r: any): CaseRow => ({ ...r, rate_defaults: r?.rate_defaults ?? {} })

export async function listCases(): Promise<CaseRow[]> {
  const { data } = await createClient()
    .from('cases').select(CASE_COLS).order('opened_on', { ascending: false })
  return ((data ?? []) as any[]).map(asCase)
}

export async function getCase(id: string): Promise<CaseRow | null> {
  const { data } = await createClient().from('cases').select(CASE_COLS).eq('id', id).maybeSingle()
  return data ? asCase(data) : null
}

/** Opens a case. No title: the name comes from the parts (caseTitle), so the
 *  column is left NULL rather than seeded with a copy that could then drift. */
export async function createCase(input: Partial<CaseRow>): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('cases').insert({
    title: null,
    case_type: clean(input.case_type), our_vessel: clean(input.our_vessel),
    our_vessel_type: clean(input.our_vessel_type), other_party: clean(input.other_party),
    case_ref: clean(input.case_ref), principal: clean(input.principal),
    opened_on: input.opened_on, notes: clean(input.notes),
    created_by: user?.id ?? null,
  }).select('id').single()
  if (error) return { error: error.message }
  return { id: data?.id }
}

export async function updateCase(id: string, patch: Partial<CaseRow>): Promise<{ error?: string }> {
  const { data, error } = await createClient().from('cases').update(patch).eq('id', id).select('id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'That case could not be updated.' }
  return {}
}

/** Concluding a case stamps closed_on; re-opening clears it, so "how long was it open"
 *  stays honest in both directions. */
export async function setCaseStatus(id: string, next: CaseStatus): Promise<{ error?: string }> {
  return updateCase(id, {
    status: next,
    // todayKey() is TRINIDAD, never the host. toISOString() is UTC, so a case concluded
    // after 8pm local would be stamped tomorrow — the trap the cargo module documents.
    closed_on: next === 'concluded' ? todayKey() : null,
  } as Partial<CaseRow>)
}

export async function deleteCase(id: string): Promise<{ error?: string }> {
  const { error } = await createClient().from('cases').delete().eq('id', id)
  return error ? { error: error.message } : {}
}

// ── Attendances ─────────────────────────────────────────────────────────────

const ATT_COLS =
  'id, case_id, attendee_profile_id, attendee_name, attended_on, start_time, end_time, minutes, description, ' +
  'location, note, rate_type, rate_amount, days, currency, charge_amount, claim_id, ' +
  'attendee:profiles!case_attendances_attendee_profile_id_fkey(full_name), ' +
  'claim:case_claims(claim_no)'

export async function listAttendances(caseId: string): Promise<CaseAttendance[]> {
  const supabase = createClient()
  const [{ data }, { data: docs }] = await Promise.all([
    supabase.from('case_attendances').select(ATT_COLS).eq('case_id', caseId)
      .order('attended_on', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('case_documents').select('attendance_id').eq('case_id', caseId).not('attendance_id', 'is', null),
  ])
  const docCount = new Map<string, number>()
  for (const d of ((docs ?? []) as { attendance_id: string }[])) {
    docCount.set(d.attendance_id, (docCount.get(d.attendance_id) ?? 0) + 1)
  }
  return ((data ?? []) as any[]).map(r => ({
    id: r.id, case_id: r.case_id,
    attendee_profile_id: r.attendee_profile_id ?? null,
    attendee_name: r.attendee_name ?? null,
    attendee_label: r.attendee?.full_name ?? r.attendee_name ?? 'Unknown',
    attended_on: r.attended_on,
      start_time: r.start_time ?? null, end_time: r.end_time ?? null,
      minutes: num(r.minutes),
    description: r.description ?? null, location: r.location ?? null, note: r.note ?? null,
    rate_type: (r.rate_type ?? 'hourly') as RateType,
    rate_amount: r.rate_amount == null ? null : Number(r.rate_amount),
    days: r.days == null ? null : Number(r.days),
    currency: r.currency ?? 'USD',
    charge_amount: r.charge_amount == null ? null : Number(r.charge_amount),
    claim_id: r.claim_id ?? null,
    claim_no: r.claim?.claim_no ?? null,
    document_count: docCount.get(r.id) ?? 0,
  }))
}

export interface AttendanceInput {
  attendee_profile_id: string | null
  attendee_name: string | null
  attended_on: string
  /** Trinidad wall-clock, when the times are what was known. The MINUTES stay the
   *  authority for every total — the clock is what worked them out, not what replaces
   *  them — which is why a span running past midnight is not a contradiction. */
  start_time?: string | null
  end_time?: string | null
  minutes: number
  description: string | null
  location: string | null
  note: string | null
  rate_type: RateType
  rate_amount: number | null
  days: number | null
  currency: string
}

/** The database CHECK requires exactly one attendee, and a blank string is not a name.
 *  Normalise here so the UI never trips the constraint with an empty text box. */
function normaliseAttendee(i: AttendanceInput) {
  const name = clean(i.attendee_name)
  return i.attendee_profile_id
    ? { attendee_profile_id: i.attendee_profile_id, attendee_name: null }
    : { attendee_profile_id: null, attendee_name: name }
}

export async function addAttendance(caseId: string, i: AttendanceInput): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { attendee_profile_id, attendee_name } = normaliseAttendee(i)
  if (!attendee_profile_id && !attendee_name) return { error: 'Choose who attended, or type a name.' }

  const { data, error } = await supabase.from('case_attendances').insert({
    case_id: caseId, attendee_profile_id, attendee_name,
    attended_on: i.attended_on, minutes: i.minutes,
    start_time: i.start_time ?? null, end_time: i.end_time ?? null,
    description: clean(i.description), location: clean(i.location), note: clean(i.note),
    rate_type: i.rate_type, rate_amount: i.rate_amount,
    days: i.rate_type === 'daily' ? i.days : null,
    currency: i.currency, created_by: user?.id ?? null,
  }).select('id').single()
  if (error) return { error: error.message }
  return { id: data?.id }
}

/** Correct a mistyped attendance in place — the date, the time, who attended, the rate.
 *
 *  A CLAIMED attendance is refused: its claim carries a recorded total that was exported
 *  and invoiced outside the app, and silently changing the lines underneath would make
 *  the two disagree with nothing to show for it. Undo the claim, correct it, re-claim. */
export async function updateAttendance(id: string, i: AttendanceInput): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: existing } = await supabase.from('case_attendances')
    .select('claim_id, claim:case_claims(claim_no)').eq('id', id).maybeSingle()
  if ((existing as any)?.claim_id) {
    const no = (existing as any).claim?.claim_no
    return { error: `This is on claim ${no ? `#${no}` : 'a claim'}. Undo that claim before changing it.` }
  }
  const { attendee_profile_id, attendee_name } = normaliseAttendee(i)
  if (!attendee_profile_id && !attendee_name) return { error: 'Choose who attended, or type a name.' }

  const { data, error } = await supabase.from('case_attendances').update({
    attendee_profile_id, attendee_name,
    attended_on: i.attended_on, minutes: i.minutes,
    start_time: i.start_time ?? null, end_time: i.end_time ?? null,
    description: clean(i.description), location: clean(i.location), note: clean(i.note),
    rate_type: i.rate_type, rate_amount: i.rate_amount,
    days: i.rate_type === 'daily' ? i.days : null,
    currency: i.currency,
  }).eq('id', id).select('id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'That attendance could not be changed.' }
  return {}
}

export async function deleteAttendance(id: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: existing } = await supabase.from('case_attendances')
    .select('claim_id, claim:case_claims(claim_no)').eq('id', id).maybeSingle()
  if ((existing as any)?.claim_id) {
    const no = (existing as any).claim?.claim_no
    return { error: `This is on claim ${no ? `#${no}` : 'a claim'}. Undo that claim before deleting it.` }
  }
  const { error } = await supabase.from('case_attendances').delete().eq('id', id)
  return error ? { error: error.message } : {}
}

/**
 * One tap of a quick button = one 10-minute block in FEES AND COSTS, attributed to you.
 *
 * It lands there and not in attendances because that is how the work reads from this side:
 * an attendance is somebody going somewhere; a call or an email is the correspondency
 * service, which is a fee. It prices itself from the case's standing rate for that kind
 * when there is one, and is logged unpriced when there is not — never blocked.
 *
 * `clientRef` MUST be freshly minted per TAP and reused only on a retry. That is the
 * distinction the whole idempotency scheme rests on: two taps are meant to make two
 * chunks, but one tap replayed over a flaky connection must not. The database settles it
 * via a partial unique index (CLAUDE.md; the inventory_movements pattern).
 */
export async function addQuickBlock(
  caseId: string, kind: 'call' | 'email', clientRef: string,
): Promise<{ id?: string; error?: string }> {
  const { data, error } = await createClient()
    .rpc('case_add_quick_charge', { p_case: caseId, p_kind: kind, p_client_ref: clientRef })
  if (error) return { error: error.message }
  return { id: data as string }
}

// ── Fees and costs ──────────────────────────────────────────────────────────

const CHG_COLS =
  'id, case_id, kind, description, payee, incurred_on, minutes, start_time, end_time, ' +
  'qty, unit_amount, currency, amount, claim_id, claim:case_claims(claim_no), ' +
  'creator:profiles!case_charges_created_by_fkey(full_name)'

export async function listCharges(caseId: string): Promise<CaseCharge[]> {
  const supabase = createClient()
  const [{ data }, { data: docs }] = await Promise.all([
    supabase.from('case_charges').select(CHG_COLS).eq('case_id', caseId).order('incurred_on', { ascending: false }),
    supabase.from('case_documents').select('charge_id').eq('case_id', caseId).not('charge_id', 'is', null),
  ])
  const docCount = new Map<string, number>()
  for (const d of ((docs ?? []) as { charge_id: string }[])) {
    docCount.set(d.charge_id, (docCount.get(d.charge_id) ?? 0) + 1)
  }
  return ((data ?? []) as any[]).map(c => ({
    id: c.id, case_id: c.case_id, kind: (c.kind ?? '') as string,
    description: c.description ?? '', payee: c.payee ?? null, incurred_on: c.incurred_on,
    minutes: c.minutes == null ? null : Number(c.minutes),
    start_time: c.start_time ?? null, end_time: c.end_time ?? null,
    qty: num(c.qty, 1), unit_amount: num(c.unit_amount), currency: c.currency ?? 'USD',
    amount: num(c.amount),
    creator_label: c.creator?.full_name ?? null,
    claim_id: c.claim_id ?? null, claim_no: c.claim?.claim_no ?? null,
    document_count: docCount.get(c.id) ?? 0,
  }))
}

export interface ChargeInput {
  kind: string
  description: string
  payee: string | null
  incurred_on: string
  /** Set it and the fee is TIME: unit_amount is then read as an hourly rate and the
   *  database works out the money. Leave it null for a purchase. */
  minutes?: number | null
  start_time?: string | null
  end_time?: string | null
  qty: number
  unit_amount: number
  currency: string
}

export async function addCharge(caseId: string, i: ChargeInput): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('case_charges').insert({
    case_id: caseId, kind: i.kind.trim() || 'Other', description: i.description.trim(),
    payee: clean(i.payee), incurred_on: i.incurred_on, minutes: i.minutes ?? null,
    start_time: i.start_time ?? null, end_time: i.end_time ?? null,
    qty: i.qty, unit_amount: i.unit_amount, currency: i.currency,
    created_by: user?.id ?? null,
  }).select('id').single()
  if (error) return { error: error.message }
  return { id: data?.id }
}

export async function updateCharge(id: string, i: ChargeInput): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: existing } = await supabase.from('case_charges')
    .select('claim_id, claim:case_claims(claim_no)').eq('id', id).maybeSingle()
  if ((existing as any)?.claim_id) {
    const no = (existing as any).claim?.claim_no
    return { error: `This is on claim ${no ? `#${no}` : 'a claim'}. Undo that claim before changing it.` }
  }
  const { data, error } = await supabase.from('case_charges').update({
    kind: i.kind.trim() || 'Other', description: i.description.trim(), payee: clean(i.payee),
    incurred_on: i.incurred_on, minutes: i.minutes ?? null,
    start_time: i.start_time ?? null, end_time: i.end_time ?? null,
    qty: i.qty, unit_amount: i.unit_amount, currency: i.currency,
  }).eq('id', id).select('id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'That charge could not be changed.' }
  return {}
}

export async function deleteCharge(id: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: existing } = await supabase.from('case_charges')
    .select('claim_id, claim:case_claims(claim_no)').eq('id', id).maybeSingle()
  if ((existing as any)?.claim_id) {
    const no = (existing as any).claim?.claim_no
    return { error: `This is on claim ${no ? `#${no}` : 'a claim'}. Undo that claim before deleting it.` }
  }
  const { error } = await supabase.from('case_charges').delete().eq('id', id)
  return error ? { error: error.message } : {}
}

// ── Documents ───────────────────────────────────────────────────────────────

export async function listDocuments(caseId: string): Promise<CaseDocument[]> {
  const { data } = await createClient()
    .from('case_documents')
    .select('id, case_id, attendance_id, charge_id, name, category, storage_path, content_type, size_bytes, created_at')
    .eq('case_id', caseId).order('created_at', { ascending: false })
  return ((data ?? []) as unknown) as CaseDocument[]
}

/**
 * Upload a file and index it.
 *
 * The compensating delete is the important part, lifted from lib/documents/api.ts: if
 * the row insert fails after the object landed, remove the object. Otherwise the bucket
 * slowly fills with files nothing references and nobody can find.
 */
export async function uploadDocument(
  caseId: string, file: File, link?: { attendanceId?: string; chargeId?: string; category?: string },
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const path = `${caseId}/${crypto.randomUUID()}_${sanitizeStorageName(file.name)}`

  const { error: upErr } = await supabase.storage.from(CASE_BUCKET)
    .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (upErr) return { error: upErr.message }

  const { error } = await supabase.from('case_documents').insert({
    case_id: caseId,
    attendance_id: link?.attendanceId ?? null,
    charge_id: link?.chargeId ?? null,
    // PERSISTED, unlike invoice_line_items.receipt_name, which was display-only — so a
    // reloaded invoice just says "Receipt" and nobody can tell what it was.
    name: file.name,
    category: link?.category ?? null,
    storage_path: path,
    content_type: file.type || null,
    size_bytes: file.size,
    uploaded_by: user?.id ?? null,
  })
  if (error) {
    await supabase.storage.from(CASE_BUCKET).remove([path]).catch(() => {})
    return { error: error.message }
  }
  return {}
}

/** Removes the object as well as the row. Detaching without this is what orphans files
 *  in invoice-receipts today. */
export async function deleteDocument(doc: Pick<CaseDocument, 'id' | 'storage_path'>): Promise<{ error?: string }> {
  const supabase = createClient()
  await supabase.storage.from(CASE_BUCKET).remove([doc.storage_path]).catch(() => {})
  const { error } = await supabase.from('case_documents').delete().eq('id', doc.id)
  return error ? { error: error.message } : {}
}

/**
 * Pull a stored file into memory as a File, ready to hand to deliverFile/shareFile.
 *
 * Every other stored-file open in this app is window.open(signedUrl) — which is a dead
 * end in an installed iOS PWA: there is no download manager, so the file opens in a
 * chrome-less window with no share button and no way out. Downloading to a blob first is
 * the only route that can then reach navigator.share.
 *
 * Callers MUST hold the returned File and call deliverFile from a LATER, unspent user
 * gesture — a file must exist before the gesture that shares it.
 */
export async function fetchStoredFile(doc: Pick<CaseDocument, 'storage_path' | 'name' | 'content_type'>): Promise<File> {
  const { data, error } = await createClient().storage.from(CASE_BUCKET).download(doc.storage_path)
  if (error || !data) throw new Error(error?.message ?? 'That file could not be downloaded.')
  return new File([data], doc.name, { type: doc.content_type || data.type || 'application/octet-stream' })
}

// ── Claims ──────────────────────────────────────────────────────────────────

export async function listClaims(caseId: string): Promise<CaseClaim[]> {
  const { data } = await createClient()
    .from('case_claims')
    .select('id, case_id, claim_no, currency, cutoff_on, total, item_count, reference, invoiced_on, note, created_at')
    .eq('case_id', caseId).order('claim_no', { ascending: false })
  return ((data ?? []) as any[]).map(c => ({ ...c, total: num(c.total), item_count: num(c.item_count) }))
}

/** Close off one currency's outstanding items up to a cutoff.
 *
 *  The RPC enforces the three rules that must not depend on a screen: one claim carries
 *  one currency, an unpriced attendance is never claimed, and an item added late but
 *  dated inside a claimed period stays outstanding for the next claim. */
export async function createClaim(input: {
  caseId: string; currency: string; cutoff: string; reference?: string | null; note?: string | null
}): Promise<{ claim?: { claim_id: string; claim_no: number; items: number; total: number }; error?: string }> {
  const { data, error } = await createClient().rpc('case_claim_items', {
    p_case: input.caseId, p_currency: input.currency, p_cutoff: input.cutoff,
    p_reference: input.reference ?? null, p_note: input.note ?? null,
  })
  if (error) return { error: error.message }
  return { claim: data as any }
}

/** Undo. Deleting the claim releases every item back to unclaimed automatically, because
 *  both claim_id FKs are ON DELETE SET NULL. No RPC, and deliberately no trigger — a
 *  guard fighting exactly this cascade is what broke the old model twice. */
export async function deleteClaim(id: string): Promise<{ error?: string }> {
  const { error } = await createClient().from('case_claims').delete().eq('id', id)
  return error ? { error: error.message } : {}
}

/** Record that a claim was invoiced outside the app. The reference is prompted but never
 *  required — not having the number to hand must not stop the claim being marked. */
export async function markClaimInvoiced(
  id: string, reference: string | null, invoicedOn: string,
): Promise<{ error?: string }> {
  const { data, error } = await createClient().from('case_claims')
    .update({ reference: clean(reference), invoiced_on: invoicedOn }).eq('id', id).select('id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'That claim could not be updated.' }
  return {}
}
