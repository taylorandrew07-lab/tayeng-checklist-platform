'use client'

// One place that turns a ledger row into a sentence, so "My activity", the admin
// history and the CSV export can never describe the same movement differently.
//
// The quantity is rendered from units_per_pack_at_time — what the item's pack
// size WAS when the row was written — not from the item's current setting.
// Otherwise correcting a pack size from 24 to 12 silently rewrites what every
// past entry appears to say.

import { formatQty } from '@/lib/inventory/packs'
import type { MovementDetail, MovementKind } from '@/lib/inventory/types'

export const MOVEMENT_VERB: Record<MovementKind, string> = {
  receive: 'Added',
  take: 'Took',
  move: 'Moved',
  adjust: 'Recounted',
  check_out: 'Checked out',
  check_in: 'Checked in',
  correction: 'Corrected',
}

/** The quantity as it was recorded, in the words used at the time. */
export function movementQty(m: MovementDetail): string {
  if (m.qty_units === 0) return ''
  return formatQty(m.qty_units, {
    units_per_pack: m.units_per_pack_at_time ?? 1,
    unit_label: m.item_unit_label,
    pack_label: m.item_pack_label,
  })
}

/** "Took 1 box (24 bottles) from Main office" — the whole row in one line. */
export function movementSentence(m: MovementDetail): string {
  const qty = movementQty(m)
  const head = [MOVEMENT_VERB[m.kind], qty].filter(Boolean).join(' ')

  switch (m.kind) {
    case 'take':
      return `${head} from ${m.from_location_name ?? 'somewhere'}`
    case 'receive':
      return `${head} to ${m.to_location_name ?? 'somewhere'}`
    case 'move':
      return `${head} from ${m.from_location_name ?? 'somewhere'} to ${m.to_location_name ?? 'somewhere'}`
    case 'adjust': {
      const where = m.from_location_name ?? m.to_location_name
      if (!qty) return `Counted at ${where ?? 'a location'} — matched`
      const dir = m.to_location_id ? 'more than recorded' : 'fewer than recorded'
      return `Recounted at ${where ?? 'a location'} — ${qty} ${dir}`
    }
    case 'check_out':
      return `Checked out to ${m.holder_name ?? 'someone'}`
    case 'check_in':
      return `Checked in from ${m.holder_name ?? 'someone'}`
    case 'correction':
      return `Corrected an earlier entry${qty ? ` (${qty})` : ''}`
  }
}

/**
 * The compact form for the consumables list: "Neil took 1 box".
 *
 * Name first, because the question this answers is "who has been going through
 * these" — not "what happened". No location: at a glance you want the person and
 * the amount, and the full sentence is one tab away in History.
 */
export function movementBrief(m: MovementDetail): string {
  const who = m.actor_name ?? 'Someone'
  const qty = movementQty(m)
  switch (m.kind) {
    case 'take': return `${who} took ${qty}`
    case 'receive': return `${who} added ${qty}`
    case 'move': return `${who} moved ${qty}`
    case 'adjust': return qty ? `${who} recounted (${qty} out)` : `${who} counted it — matched`
    case 'check_out': return `${who} checked it out`
    case 'check_in': return `${who} checked it in`
    case 'correction': return `${who} corrected an entry`
  }
}

export function MovementLine({ m }: { m: MovementDetail }) {
  return (
    <span className={m.reversed ? 'text-gray-400 line-through' : ''}>
      {movementSentence(m)}
    </span>
  )
}
