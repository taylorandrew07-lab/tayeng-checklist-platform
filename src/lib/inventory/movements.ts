// THE inventory write seam. Everything that changes stock goes through here.
//
// This mirrors submitJobWithRetry (lib/jobs/complete.ts) — but with one addition
// that is not optional, and the reason this file has its own comment block:
//
//   submitJobWithRetry is safe to retry because `SET submitted_at = now()` is
//   IDEMPOTENT. Running it twice is running it once.
//
//   A TAKE IS NOT. Retrying a take double-decrements the stock. On flaky
//   dockside wifi "the request may never land" is the normal case, so blindly
//   copying the repo's retry pattern here would be ACTIVELY UNSAFE.
//
// Hence clientRef: one crypto.randomUUID() per user TAP — not per attempt —
// replayed on every retry of that tap. uq_inventory_movements_client_ref
// (migration 190) settles the race in the database, and the RPC returns the
// original movement with warning 'duplicate' instead of writing a second one.
//
// Callers must therefore generate a ref ONCE, when the dialog's button is
// pressed, and reuse it for the "Record it anyway" confirmation too — that is a
// retry of the same tap, not a new one.

import { createClient } from '@/lib/supabase/client'
import { withTimeout } from '@/lib/utils'
import type { MovementKind, MovementResult } from './types'

const ATTEMPTS = 3
const CALL_TIMEOUT_MS = 20_000

export interface MovementInput {
  itemId: string
  kind: Exclude<MovementKind, 'correction'>
  /** Base units. Ignored for a recount (use countedUnits) and for custody. */
  qtyUnits?: number
  /** 'adjust' only: the ABSOLUTE number counted on the shelf, not a delta. */
  countedUnits?: number
  /** Packs as typed, recorded so history reads the way it was entered. */
  packs?: number | null
  fromLocationId?: string | null
  toLocationId?: string | null
  holderId?: string | null
  /** 'receive' only: the batch date for the receiving location. */
  expiryDate?: string | null
  note?: string | null
  /** Second, deliberate act after a 'short' outcome. See stockShortMessage. */
  allowNegative?: boolean
  /** ONE per user tap. Generate with newMovementRef() and reuse across retries. */
  clientRef: string
}

export type MovementOutcome =
  | 'ok'        // recorded (or already recorded — a duplicate is a success)
  | 'short'     // would go negative; re-call with allowNegative to confirm
  | 'denied'    // RLS or a rule said no. Retrying will not help
  | 'conflict'  // already checked out, archived, wrong item type…
  | 'failed'    // never landed. The user's entry is not saved

export interface MovementResponse {
  outcome: MovementOutcome
  result?: MovementResult
  /** Ready to show. The RPC's messages already name the numbers. */
  error?: string
}

/** One per user tap. Not per attempt — that is the whole point. */
export function newMovementRef(): string {
  return crypto.randomUUID()
}

/**
 * Map a Postgres error to an outcome. The RPC raises with deliberate SQLSTATEs
 * so the UI can tell "you may not" from "confirm and I will" from "try again".
 */
export function describeMovementError(
  error: { code?: string; message?: string } | null,
): { outcome: MovementOutcome; message: string } {
  const message = error?.message?.trim() || 'Something went wrong recording that.'
  switch (error?.code) {
    case '23514': return { outcome: 'short', message }     // the negative guard
    case '42501': return { outcome: 'denied', message }    // not permitted
    case '22023':                                          // bad shape / wrong kind
    case '23503':                                          // missing item or person
    case '23505': return { outcome: 'conflict', message }  // already checked out
    default: return { outcome: 'failed', message }
  }
}

function toParams(input: MovementInput) {
  return {
    p_item_id: input.itemId,
    p_kind: input.kind,
    p_qty_units: input.qtyUnits ?? null,
    p_from_location_id: input.fromLocationId ?? null,
    p_to_location_id: input.toLocationId ?? null,
    p_holder_id: input.holderId ?? null,
    p_counted_units: input.countedUnits ?? null,
    p_packs: input.packs ?? null,
    p_expiry_date: input.expiryDate ?? null,
    p_note: input.note ?? null,
    p_allow_negative: input.allowNegative ?? false,
    p_client_ref: input.clientRef,
  }
}

/** The RPC returns SETOF, so supabase-js hands back an array. */
function firstRow(data: unknown): MovementResult | undefined {
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as MovementResult[]
  return rows[0]
}

/** A single attempt. Use recordMovement() unless you are handling retries yourself. */
export async function recordMovementOnce(input: MovementInput): Promise<MovementResponse> {
  const { data, error } = await withTimeout(
    createClient().rpc('inventory_record_movement', toParams(input)),
    CALL_TIMEOUT_MS,
    'Recording that',
  )
  if (error) {
    const { outcome, message } = describeMovementError(error)
    return { outcome, error: message }
  }
  const result = firstRow(data)
  if (!result) return { outcome: 'failed', error: 'The movement was not recorded. Try again.' }
  return { outcome: 'ok', result }
}

/**
 * Record a movement, retrying through a flaky connection.
 *
 * The three ideas carried over from submitJobWithRetry:
 *   * a thrown or timed-out request means UNKNOWN, not failed — the write often
 *     lands and only the response is lost, so we always verify before retrying;
 *   * distinct outcomes, not a boolean, because the copy differs for each;
 *   * verification reads back the thing we actually wrote.
 *
 * The verify here is stronger than that path's `submitted_at` check: clientRef
 * identifies THIS tap exactly, and a surveyor can always read their own ledger
 * rows (migration 190's actor_id arm), so the read is never blocked.
 */
export async function recordMovement(input: MovementInput): Promise<MovementResponse> {
  let last: MovementResponse = { outcome: 'failed', error: 'Not saved — check your connection and try again.' }

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await recordMovementOnce(input)
      // Anything but a transport failure is a real answer from the database.
      // Retrying a denial or a shortfall would only produce the same answer.
      if (res.outcome !== 'failed') return res
      last = res
    } catch {
      // Network or timeout. The write may well have landed — verify below.
    }

    const landed = await findByRef(input.clientRef)
    if (landed) return { outcome: 'ok', result: landed }

    if (attempt < ATTEMPTS) await new Promise(r => setTimeout(r, attempt * 1500))
  }

  return last
}

/**
 * Undo. Never deletes: it writes the mirrored `correction` row, so the history
 * shows the mistake AND the correction. A surveyor may undo their own entry
 * within 24 hours; an admin may undo any.
 */
export async function reverseMovement(
  movementId: string,
  note?: string | null,
  clientRef: string = newMovementRef(),
): Promise<MovementResponse> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const { data, error } = await withTimeout(
        createClient().rpc('inventory_reverse_movement', {
          p_movement_id: movementId,
          p_note: note ?? null,
          p_client_ref: clientRef,
        }),
        CALL_TIMEOUT_MS,
        'Undoing that',
      )
      if (error) {
        const { outcome, message } = describeMovementError(error)
        if (outcome !== 'failed') return { outcome, error: message }
      } else {
        const result = firstRow(data)
        if (result) return { outcome: 'ok', result }
      }
    } catch {
      // Verify below before deciding it failed.
    }

    const landed = await findByRef(clientRef)
    if (landed) return { outcome: 'ok', result: landed }

    if (attempt < ATTEMPTS) await new Promise(r => setTimeout(r, attempt * 1500))
  }

  return { outcome: 'failed', error: 'Could not undo that — check your connection and try again.' }
}

/**
 * Did this tap already land? Reads the ledger by client_ref.
 *
 * Returns a partial MovementResult: enough to confirm the write, not the full
 * post-movement stock state (which would need another read). Callers that need
 * fresh numbers reload the list anyway — and useRealtimeRefresh has usually
 * beaten them to it.
 */
async function findByRef(clientRef: string): Promise<MovementResult | undefined> {
  try {
    const { data } = await withTimeout(
      createClient()
        .from('inventory_movements')
        .select('id, item_id, kind, qty_units, from_location_id, to_location_id')
        .eq('client_ref', clientRef)
        .maybeSingle(),
      8_000,
      'Checking',
    )
    if (!data) return undefined
    const row = data as {
      id: string; item_id: string; kind: MovementKind; qty_units: number
      from_location_id: string | null; to_location_id: string | null
    }
    return {
      movement_id: row.id,
      item_id: row.item_id,
      kind: row.kind,
      qty_units: Number(row.qty_units ?? 0),
      from_location_id: row.from_location_id,
      from_qty_units: null,
      to_location_id: row.to_location_id,
      to_qty_units: null,
      total_qty_units: 0,
      held_by: null,
      warning: null,
    }
  } catch {
    // Could not verify either. The caller retries.
    return undefined
  }
}
