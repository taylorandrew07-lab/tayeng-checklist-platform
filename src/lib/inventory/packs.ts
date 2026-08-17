// Pack ↔ unit arithmetic. PURE — no Supabase, no React. Unit-tested in packs.test.ts.
//
// Stock is stored in base units (bottles, sticks) and spoken in packs ("3 boxes").
// This module is the ONLY place that converts between them. Every count the user
// sees goes through formatQty(); every count the user types goes through
// toBaseUnits(). Doing the arithmetic inline anywhere else is how "2 boxes + 3
// bottles" ends up meaning different things on two screens.
//
// NOTE: quantities arrive from Postgres as NUMERIC, and supabase-js hands those
// back as STRINGS on some paths. Every function here coerces with num() rather
// than trusting the type — "72" + 24 === "7224" is a very quiet bug.

import type { InventoryItem } from './types'

/** The fields any quantity display needs. Keeps callers from passing whole rows. */
export type PackShape = Pick<InventoryItem, 'units_per_pack' | 'unit_label' | 'pack_label'>

export interface PackSplit {
  packs: number
  loose: number
  unitsTotal: number
}

/** NUMERIC arrives as a string on some supabase-js paths. Never trust the type. */
export function num(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

/** A pack size of 0 or a missing one would divide by zero. Treat as "no packs". */
function perPack(item: PackShape): number {
  const n = Math.trunc(num(item.units_per_pack))
  return n >= 1 ? n : 1
}

/** True when this item has a meaningful pack level at all. */
export function hasPacks(item: PackShape): boolean {
  return perPack(item) > 1
}

/**
 * 72 units at 24/pack → { packs: 3, loose: 0 }. 77 → { packs: 3, loose: 5 }.
 *
 * Negative totals (the miscount case) split toward zero, so −30 at 24/pack is
 * −1 pack and −6 loose rather than −2 packs and +18.
 */
export function splitPacks(unitsTotal: number | string, unitsPerPack: number): PackSplit {
  const total = num(unitsTotal)
  const size = Math.trunc(num(unitsPerPack)) >= 1 ? Math.trunc(num(unitsPerPack)) : 1
  const sign = total < 0 ? -1 : 1
  const abs = Math.abs(total)
  return {
    packs: sign * Math.floor(abs / size),
    loose: sign * (abs % size),
    unitsTotal: total,
  }
}

/**
 * "1 box" / "3 boxes" / "2 batteries". Enough English for the words that appear
 * on a stores shelf — a bare +s gives "boxs", which looks broken on the one
 * label we are guaranteed to use.
 *
 * A label that ALREADY ends in s is left alone, because on this shelf that means
 * someone typed a plural ("gloves", "wipes"). The cost is that a singular noun
 * ending in s ("gas") stays "gas" — rare, and far less jarring than "gloveses".
 */
export function pluralise(n: number, label: string): string {
  return `${fmt(n)} ${plural(n, label)}`
}

function plural(n: number, label: string): string {
  if (Math.abs(n) === 1) return label
  const w = label.toLowerCase()
  if (w.endsWith('s')) return label
  if (w.endsWith('x') || w.endsWith('z') || w.endsWith('ch') || w.endsWith('sh')) return `${label}es`
  if (w.endsWith('y') && !/[aeiou]y$/.test(w)) return `${label.slice(0, -1)}ies`
  return `${label}s`
}

/** Trim trailing zeros so NUMERIC(14,3) doesn't render "72.000". */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)))
}

/**
 * THE display seam. Every stock figure in the UI comes from here.
 *
 *   24/box, 72  → "3 boxes (72 bottles)"
 *   24/box, 77  → "3 boxes + 5 bottles (77 bottles)"
 *   24/box, 12  → "12 bottles"
 *   1/unit, 72  → "72 bottles"          (no pack level — never "72 packs")
 *   24/box, 0   → "None"
 *   24/box, −6  → "−6 bottles (short)"
 */
export function formatQty(unitsTotal: number | string, item: PackShape): string {
  const total = num(unitsTotal)
  if (total === 0) return 'None'
  if (total < 0) return `−${pluralise(Math.abs(total), item.unit_label)} (short)`

  if (!hasPacks(item)) return pluralise(total, item.unit_label)

  const { packs, loose } = splitPacks(total, perPack(item))
  if (packs === 0) return pluralise(loose, item.unit_label)

  const packPart = pluralise(packs, item.pack_label)
  const head = loose === 0 ? packPart : `${packPart} + ${pluralise(loose, item.unit_label)}`
  return `${head} (${pluralise(total, item.unit_label)})`
}

/**
 * Short form for pills and tight table cells — the headline unit only.
 *
 *   24/box, 72 → "3 boxes"     24/box, 77 → "3 boxes +"
 *   24/box, 12 → "12 bottles"  1/unit, 72 → "72 bottles"
 */
export function formatQtyShort(unitsTotal: number | string, item: PackShape): string {
  const total = num(unitsTotal)
  if (total === 0) return 'None'
  if (total < 0) return `−${pluralise(Math.abs(total), item.unit_label)}`
  if (!hasPacks(item)) return pluralise(total, item.unit_label)

  const { packs, loose } = splitPacks(total, perPack(item))
  if (packs === 0) return pluralise(loose, item.unit_label)
  return loose === 0 ? pluralise(packs, item.pack_label) : `${pluralise(packs, item.pack_label)} +`
}

/** The two-input take form ("2 boxes + 3 bottles") back to base units. */
export function toBaseUnits(packs: number | string, loose: number | string, unitsPerPack: number): number {
  const size = Math.trunc(num(unitsPerPack)) >= 1 ? Math.trunc(num(unitsPerPack)) : 1
  return num(packs) * size + num(loose)
}

/**
 * The live preview under the movement dialog's button: what this location will
 * hold once the movement lands. Returns null when there is nothing to preview.
 */
export function previewAfter(
  currentUnits: number | string,
  deltaUnits: number | string,
  item: PackShape,
): string | null {
  const delta = num(deltaUnits)
  if (delta === 0) return null
  return formatQty(num(currentUnits) + delta, item)
}
