// How a hold's readings lay out as rows. ONE decision, shared by every surface
// that draws the readings table: the surveyor's entry grid, the read-only view,
// the PDF and the public data annex.
//
// It exists because the layout had already drifted across those four. Each of
// them independently gave a MULTI-point type (Thermocouple temperature, Infrared
// gun) a full-width band heading, while a SINGLE-point type (Oxygen, Carbon
// monoxide, H2 LEL) became an ordinary left-column row. The result read as a
// hierarchy that isn't real — Oxygen looked like it sat underneath Infrared gun,
// when the two are siblings.
//
// The rule here: EVERY reading type is a title, at the same level, in the
// left-hand label column. Having points below is not what makes something a
// title — Oxygen is the name of what is being measured just as much as Infrared
// gun is. A type with points contributes a heading row plus its point rows; a
// type without them contributes one row that is both the title and the values.

import type { ReadingType, ReadingPoint } from './types'
import { isSinglePoint } from './types'

export interface ReadingRow {
  /** Stable key for the framework. */
  key: string
  /** 'title-only' carries no values (its points follow). 'title-value' is a
   *  reading type with a single channel: the title row IS the value row.
   *  'point' is one channel of a multi-point type. */
  kind: 'title-only' | 'title-value' | 'point'
  rt: ReadingType
  /** The left-hand label. */
  label: string
  /** Right-aligned secondary tag in the label column — the unit on a type title,
   *  the location group (BTM / LVL 2 / TOP) on a point. */
  tag?: string
  /** The channel this row reads, absent only on 'title-only'. */
  point?: ReadingPoint
  /** True for both title kinds. Drives heading-level styling: a reading type is
   *  a heading whether or not anything sits under it. */
  isTitle: boolean
  /** Put a gap above this row — set on every type title except the first in the
   *  hold, so the types read as separate blocks instead of one run of rows. */
  startsGroup: boolean
}

/**
 * Rows for one hold, from an ALREADY-FILTERED list of reading types.
 *
 * Filtering stays with the caller because it differs by surface — the tables use
 * `includeInTables`, the PDF uses `includeInPdf`, and every caller also applies
 * readingTypeAppliesToHold(). What must not differ is the shape below.
 */
export function readingRows(types: ReadingType[], hold: number): ReadingRow[] {
  const rows: ReadingRow[] = []

  for (const rt of types) {
    const startsGroup = rows.length > 0

    if (isSinglePoint(rt)) {
      rows.push({
        key: `${hold}:${rt.id}`,
        kind: 'title-value',
        rt,
        label: rt.name,
        tag: rt.unit || undefined,
        point: rt.points[0],
        isTitle: true,
        startsGroup,
      })
      continue
    }

    rows.push({
      key: `${hold}:${rt.id}:title`,
      kind: 'title-only',
      rt,
      label: rt.name,
      tag: rt.unit || undefined,
      isTitle: true,
      startsGroup,
    })
    for (const pt of rt.points) {
      rows.push({
        key: `${hold}:${rt.id}:${pt.id}`,
        kind: 'point',
        rt,
        label: pt.name || '—',
        tag: pt.group || undefined,
        point: pt,
        isTitle: false,
        startsGroup: false,
      })
    }
  }

  return rows
}
