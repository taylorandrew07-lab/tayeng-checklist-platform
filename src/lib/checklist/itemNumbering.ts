/**
 * Checklist item numbering.
 *
 * By default the template builder auto-numbers each SECTION's fields 1..n, and re-stamps them on
 * every edit (add / patch / delete / reorder) so the sequence stays gap-free.
 *
 * That is wrong for templates transcribed from a paper form, where the numbering is authored by
 * hand and is not positional:
 *   - Brine Transfer numbers items 1..33 CONTINUOUSLY across all five phases, with lettered
 *     conditional sub-items ("1A", "6B", "20A"). Section-local renumbering would restart each
 *     phase at 1 and destroy the letters.
 *   - The BPTT Fuel Transfer seed used "C1A".."C1D" for its reconciliation block.
 * Before this module existed, a single-character label edit was enough to silently re-stamp all
 * of it, breaking the correspondence surveyors rely on between the app and the paper checklist.
 *
 * So numbering is a per-template choice: `manualNumbering` templates keep exactly what the seed
 * SQL (or the admin) authored; everything else auto-numbers as it always has. Note that a heuristic
 * cannot substitute for this flag — a hand-authored "6" is indistinguishable from an auto "6".
 */

/** Minimal shape both the builder model and the DB row satisfy. */
export interface NumberableField {
  field_type: string
  item_number?: string | null
  order_index?: number
}

/** Layout fields carry no visible number. */
export function isLayoutField(field: Pick<NumberableField, 'field_type'>): boolean {
  return field.field_type === 'heading' || field.field_type === 'divider'
}

/**
 * The number a field should display, given its position among its section's fields.
 * When `manualNumbering` is set, the stored number is returned untouched.
 */
export function itemNumberFor<T extends NumberableField>(
  fields: T[],
  index: number,
  manualNumbering = false,
): string {
  const field = fields[index]
  if (!field) return ''
  if (isLayoutField(field)) return ''
  if (manualNumbering) return field.item_number ?? ''

  let n = 0
  for (let i = 0; i <= index; i++) {
    if (!isLayoutField(fields[i])) n++
  }
  return String(n)
}

/**
 * Re-stamp order_index and item numbers for a section's fields.
 *
 * order_index ALWAYS follows array position — reordering must persist even under manual
 * numbering, since order_index is what every renderer sorts on. Only the visible item_number
 * is left alone.
 */
export function applyItemNumbering<T extends NumberableField>(
  fields: T[],
  manualNumbering = false,
): Array<T & { order_index: number; item_number: string }> {
  return fields.map((f, i) => ({
    ...f,
    order_index: i,
    item_number: itemNumberFor(fields, i, manualNumbering),
  }))
}
