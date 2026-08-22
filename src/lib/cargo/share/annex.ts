// The Cargo Hold Monitoring DATA ANNEX — a standalone, read-only HTML document
// of a voyage's readings and charts, served publicly at /r/[token].
//
// Why HTML and not a PDF: readings are a matrix of points × time. A 14-day
// voyage is 40+ timepoints wide, and paginating it slices the time axis into
// 8-column fragments (see CargoReportDocument's chunk(...) call), which destroys
// the one thing the document is for — reading a trend along time. Here the grid
// scrolls in both axes with the labels pinned, the way the original spreadsheet
// did. Photos stay in the PDF, where one-per-page costs nothing.
//
// SINGLE SOURCE OF TRUTH. Everything structural comes from the same helpers the
// grid, the charts and the PDF use — periodsForDate, effectiveEndDate,
// readingTypeAppliesToHold, isSinglePoint, getReadingValue, readingCellColor,
// buildHoldSeries/buildPointSeries. Nothing here re-derives them, or the annex
// would drift from the on-screen view and the report.
//
// DELIBERATELY LIGHT-ONLY. This is a document, not app chrome: it must look the
// same for every recipient, and threshold tints that changed meaning between
// light and dark would be a hazard in a document about self-heating cargo. Every
// colour is painted explicitly and the readings tints come straight out of
// readingCellColor(), so there is exactly one definition of what amber means.

import {
  type Voyage, type ReadingType, type ReadingPoint, type Period,
  readingTypeAppliesToHold, isSinglePoint, getReadingValue,
} from '../types'
import { readingRows } from '../readingRows'
import { readingCellColor } from '../colors'
import {
  monitoringDates, effectiveEndDate, periodsForDate, holdNumbers, formatVoyageDate,
} from '../periods'
import { buildHoldSeries, buildPointSeries, seriesColor, type ChartModel } from '../charts'
import { withVesselPrefix } from '@/lib/utils'
import { COMPANY } from '@/lib/company'
import { displayVoyageNumber } from '../voyageNumber'

export interface AnnexOptions {
  /** Company letterhead as a data URI. Absent → the text wordmark fallback. */
  logoDataUrl?: string | null
  /** Report number from the cargo register, when one has been issued. */
  reportNumber?: string | null
  /** When this page was rendered. NOT the age of the figures on it — see below. */
  generatedAt?: Date
  /**
   * When the surveyor last CHANGED these readings (voyage doc updatedAt), and
   * when that reached us (the row's synced_at).
   *
   * These matter more than anything else on the page. Readings are recorded
   * offline at sea and only reach the server when the surveyor next has a
   * signal, so a page rendered this minute can be showing figures from
   * yesterday morning. Stamping the render time alone — which is what this did
   * — tells a reader the opposite of the truth about a document describing
   * cargo that may be heating.
   */
  dataAsAt?: number | null
  receivedAt?: string | null
  /**
   * Whether the chart hover readout is included. Default true.
   *
   * The hover needs every series value embedded a SECOND time as JSON beside
   * the table that already holds them. Measured at a real voyage's scale that
   * is about 12% of the file, not the half it sounds like — the readings grid
   * and the chart polylines dominate. The daily snapshot a surveyor emails off
   * a vessel drops it anyway: the grid still has every figure and the charts
   * still draw every line, you simply cannot hover a point to read them out.
   * The share link keeps it — served over a normal connection, the size is
   * irrelevant there.
   *
   * Tab switching is NOT part of this. It stays in both, because the Charts
   * panel is `hidden` until a tab is clicked and would be unreachable without it.
   */
  interactive?: boolean
  /**
   * True when this copy is rendered ON the device that recorded the readings —
   * the daily snapshot a surveyor exports at sea.
   *
   * It changes what the page can honestly claim. The share link is served from
   * the cloud and may genuinely be behind the device, so it warns that later
   * readings have not reached us. A snapshot rendered from the device IS the
   * record: nothing is being withheld, and saying so would be false.
   */
  selfContained?: boolean
}

// ── escaping ────────────────────────────────────────────────────────────────
// Everything below flows from a surveyor-authored document onto a PUBLIC page.
// Vessel names, point names, groups, units, remarks and observations are all
// free text, so every one of them is escaped on the way out.
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, c => ESC[c])
}

interface Timepoint { dateISO: string; period: Period }

/** Every (day, round) pair in the voyage, in order — the grid's columns. */
function voyageTimepoints(voyage: Voyage): Timepoint[] {
  const out: Timepoint[] = []
  for (const dateISO of monitoringDates(voyage.startDate, effectiveEndDate(voyage))) {
    for (const period of periodsForDate(voyage, dateISO)) out.push({ dateISO, period })
  }
  return out
}

const dayLabel = (iso: string) => formatVoyageDate(iso).replace(/^(\d{2}) (\w{3})\w* (\d{4})$/, '$1 $2')

/** A timestamp in the vessel operator's own timezone, so nobody has to convert. */
function stamp(v: Date | number | string | null | undefined): string | null {
  if (v == null) return null
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return null
  return `${d.toLocaleString('en-GB', { timeZone: 'America/Port_of_Spain', dateStyle: 'medium', timeStyle: 'short' })} AST`
}

// ── readings grid ───────────────────────────────────────────────────────────

/** The tint classes the cell colours map onto. readingCellColor() stays the
 *  authority on WHICH one applies; this only names them for the stylesheet. */
const GREEN_BG = '#dcfce7', AMBER_BG = '#fef9c3', RED_BG = '#fee2e2'

function cellTint(voyage: Voyage, rt: ReadingType, hold: number, tp: Timepoint, pt: ReadingPoint): { cls: string; style: string } {
  const c = readingCellColor(voyage, rt, hold, tp.dateISO, tp.period, pt.id)
  if (!c) return { cls: 'plain', style: '' }
  if (c.bg === RED_BG) return { cls: 'crit', style: '' }
  if (c.bg === AMBER_BG) return { cls: 'warn', style: '' }
  if (c.bg === GREEN_BG) return { cls: 'ok', style: '' }
  // Anything else is the green→amber rate-of-rise blend. Take the colour it
  // actually produced rather than recomputing the interpolation here.
  return { cls: 'grad', style: `background:${esc(c.bg)};color:${esc(c.fg)}` }
}

/** Per-column day banding: which columns belong to an odd-numbered day, and
 *  which one opens a day. Forty-eight columns of numbers read as a single block
 *  otherwise — this is what lets the eye find "the 6th" without tracking back up
 *  to the header. */
function dayBanding(voyage: Voyage, dates: string[]): { alt: boolean; opensDay: boolean }[] {
  const out: { alt: boolean; opensDay: boolean }[] = []
  dates.forEach((d, dayIndex) => {
    const n = periodsForDate(voyage, d).length
    for (let k = 0; k < n; k++) {
      // Not on the very first column — the sticky label column already draws
      // that edge, and a second rule beside it just looks like a mistake.
      out.push({ alt: dayIndex % 2 === 1, opensDay: k === 0 && out.length > 0 })
    }
  })
  return out
}

function readingsGrid(voyage: Voyage, tps: Timepoint[], types: ReadingType[]): string {
  const holds = holdNumbers(voyage.holdCount)
  const dates = monitoringDates(voyage.startDate, effectiveEndDate(voyage))
  const span = tps.length + 1
  const band = dayBanding(voyage, dates)
  /** Full banding for a header cell, which never carries a threshold colour. */
  const bandCls = (k: number) =>
    `${band[k]?.alt ? ' alt' : ''}${band[k]?.opensDay ? ' ds' : ''}`
  /** Banding for a body cell. `alt` is withheld from any cell that already has a
   *  threshold colour, so the class means "this cell is tinted" rather than
   *  being stamped everywhere and doing nothing on three quarters of them. */
  const bodyCls = (k: number, tinted: boolean) =>
    `${!tinted && band[k]?.alt ? ' alt' : ''}${band[k]?.opensDay ? ' ds' : ''}`

  let h = '<table class="grid"><thead>'
  h += '<tr class="r-date"><th class="corner" rowspan="3"><span class="corner-t">Reading</span>'
    + '<span class="corner-s">hold &middot; point</span></th>'
  for (const d of dates) {
    const n = periodsForDate(voyage, d).length
    h += `<th colspan="${n}" class="d${n > 3 ? ' d-extra' : ''}"><b>${esc(dayLabel(d))}</b></th>`
  }
  h += '</tr><tr class="r-round">'
  // A round outside the base three was added mid-voyage — flagged so a reader can
  // see the monitoring intensified rather than wondering at the extra column.
  tps.forEach((tp, k) => {
    const extra = !['0600', '1200', '1800'].includes(tp.period)
    h += `<th class="${extra ? 'extra' : ''}${bandCls(k)}">${esc(tp.period)}</th>`
  })
  h += '</tr><tr class="r-actual">'
  tps.forEach((tp, k) => {
    h += `<th class="${bandCls(k).trim()}">${esc(voyage.periodMeta?.[tp.dateISO]?.[tp.period]?.actualTime || '—')}</th>`
  })
  h += '</tr></thead><tbody>'

  for (const hold of holds) {
    // The band spans the full width, so the CELL cannot usefully be sticky-left —
    // the inner span is what stays on screen when scrolled out to day 14.
    h += `<tr class="band"><th colspan="${span}"><span class="stick">Hold ${hold}</span></th></tr>`

    // Row structure comes from the shared seam, so this table, the entry grid,
    // the read-only view and the PDF all agree on what is a title and what is a
    // channel beneath one.
    for (const r of readingRows(types.filter(rt => readingTypeAppliesToHold(rt, hold)), hold)) {
      const cls = [r.isTitle ? 'tt' : 'pt', r.startsGroup ? 'gap' : ''].filter(Boolean).join(' ')
      // Label and unit share one flex line. Floating the unit right dropped it
      // onto a second line as soon as the label filled the column ("Thermocouple
      // temperature" + "°C"), which doubled the row height.
      h += `<tr class="${cls}"><th class="s"><span class="sw"><b>${esc(r.label)}</b>`
        + `${r.tag ? `<em>${esc(r.tag)}</em>` : ''}</span></th>`

      if (!r.point) {
        // A title with its channels below it holds no readings of its own. The
        // banding still runs through it, so the day columns stay continuous down
        // the whole table rather than restarting at each type.
        tps.forEach((_tp, k) => { h += `<td class="fill${bodyCls(k, false)}"></td>` })
        h += '</tr>'
        continue
      }
      tps.forEach((tp, k) => {
        const v = getReadingValue(voyage, tp.dateISO, tp.period, hold, r.rt.id, r.point!.id)
        const t = cellTint(voyage, r.rt, hold, tp, r.point!)
        h += `<td class="${t.cls}${bodyCls(k, t.cls !== 'plain')}"${t.style ? ` style="${t.style}"` : ''}>${v === '' ? '—' : esc(v)}</td>`
      })
      h += '</tr>'
    }
  }
  return h + '</tbody></table>'
}

// ── charts ──────────────────────────────────────────────────────────────────

const CW = 940, CH = 300, PL = 48, PR = 78, PT = 16, PB = 30
const PLOTW = CW - PL - PR, PLOTH = CH - PT - PB

/** A single-hue depth ramp. Points carrying a `group` (BTM / LVL 2 / TOP …) are
 *  coloured by that group, not per probe — 21 thermocouples given 21 hues is
 *  unreadable, while depth bands show WHERE in the stow the heat sits. */
const LEVEL_RAMP = ['#172554', '#1d4ed8', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe']
const NEUTRAL = '#94a3b8'

function groupColors(rt: ReadingType): Map<string, string> {
  const groups: string[] = []
  for (const p of rt.points) if (p.group && !groups.includes(p.group)) groups.push(p.group)
  const map = new Map<string, string>()
  groups.forEach((g, i) => map.set(g, LEVEL_RAMP[i] ?? NEUTRAL))
  return map
}

interface Threshold { v: number; kind: 'w' | 'c' }

/** The y domain, padded so a threshold line just outside the data still shows.
 *  Shared with the tooltip payload so the script can map a pointer position back
 *  onto the series and say which line it is nearest. */
function chartDomain(model: ChartModel, thresholds?: Threshold[]): [number, number] {
  let lo = model.yMin, hi = model.yMax
  for (const t of thresholds ?? []) { lo = Math.min(lo, t.v); hi = Math.max(hi, t.v) }
  const pad = (hi - lo) * 0.08 || 1
  return [lo - pad, hi + pad]
}

function svgChart(id: string, model: ChartModel, colorFor: (key: string, i: number) => string, opts: {
  direct?: boolean
  thresholds?: Threshold[]
  interactive?: boolean
} = {}): string {
  const n = model.timepoints.length
  if (!model.hasData || n === 0) return '<p class="none">No readings recorded for this chart.</p>'

  const [lo, hi] = chartDomain(model, opts.thresholds)

  const x = (i: number) => PL + (n <= 1 ? PLOTW / 2 : (i / (n - 1)) * PLOTW)
  const y = (v: number) => PT + PLOTH - ((v - lo) / (hi - lo)) * PLOTH

  let s = `<svg viewBox="0 0 ${CW} ${CH}" class="chart" role="img" data-chart="${esc(id)}" `
    + `aria-label="${esc(model.readingType.name)}${model.subtitle ? ` — ${esc(model.subtitle)}` : ''}">`

  for (let k = 0; k <= 4; k++) {
    const v = lo + (k / 4) * (hi - lo)
    s += `<line class="gl" x1="${PL}" y1="${y(v).toFixed(1)}" x2="${PL + PLOTW}" y2="${y(v).toFixed(1)}"/>`
    s += `<text class="tick" x="${PL - 8}" y="${y(v).toFixed(1)}" dy="3.5" text-anchor="end">`
      + `${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)}</text>`
  }

  // One x label per day, at the day's midpoint, thinned so they never collide.
  const dayStart = new Map<string, { first: number; count: number }>()
  model.timepoints.forEach((tp, i) => {
    const e = dayStart.get(tp.dateISO)
    if (e) e.count++
    else dayStart.set(tp.dateISO, { first: i, count: 1 })
  })
  const days = [...dayStart.entries()]
  const every = Math.max(1, Math.ceil(days.length / 14))
  days.forEach(([iso, e], di) => {
    if (e.first > 0) s += `<line class="gv" x1="${x(e.first).toFixed(1)}" y1="${PT}" x2="${x(e.first).toFixed(1)}" y2="${PT + PLOTH}"/>`
    if (di % every === 0) {
      s += `<text class="tick" x="${x(e.first + (e.count - 1) / 2).toFixed(1)}" y="${PT + PLOTH + 18}" `
        + `text-anchor="middle">${esc(dayLabel(iso).split(' ')[0])}</text>`
    }
  })

  for (const t of opts.thresholds ?? []) {
    s += `<line class="thr thr-${t.kind}" x1="${PL}" y1="${y(t.v).toFixed(1)}" x2="${PL + PLOTW}" y2="${y(t.v).toFixed(1)}"/>`
    s += `<text class="thr-t thr-${t.kind}" x="${PL + 5}" y="${y(t.v).toFixed(1)}" dy="-4">${t.v}</text>`
  }

  // Null readings break the line into segments rather than being bridged — a gap
  // is a round that wasn't walked, and drawing through it would invent data.
  model.series.forEach((sr, i) => {
    const color = colorFor(sr.key, i)
    let seg: string[] = []
    const flush = () => {
      if (seg.length > 1) s += `<polyline class="ln" points="${seg.join(' ')}" stroke="${esc(color)}"/>`
      else if (seg.length === 1) { const [px, py] = seg[0].split(','); s += `<circle class="dot" cx="${px}" cy="${py}" r="1.6" fill="${esc(color)}"/>` }
      seg = []
    }
    sr.values.forEach((v, k) => { if (v == null) flush(); else seg.push(`${x(k).toFixed(1)},${y(v).toFixed(1)}`) })
    flush()
  })

  if (opts.direct) {
    // Series that finish close together would stack their labels, so push them
    // apart and draw a leader back to the line each belongs to.
    const ends = model.series
      .map((sr, i) => {
        for (let k = sr.values.length - 1; k >= 0; k--) if (sr.values[k] != null) return { sr, i, at: y(sr.values[k] as number) }
        return null
      })
      .filter((e): e is { sr: ChartModel['series'][number]; i: number; at: number } => e != null)
      .sort((a, b) => a.at - b.at)
      .map(e => ({ ...e, ly: e.at }))
    const GAP = 13
    ends.forEach((e, i) => { if (i > 0) e.ly = Math.max(e.ly, ends[i - 1].ly + GAP) })
    const over = ends.length ? ends[ends.length - 1].ly - (PT + PLOTH) : 0
    if (over > 0) ends.forEach(e => { e.ly = Math.max(PT + 6, e.ly - over) })
    for (const e of ends) {
      const color = colorFor(e.sr.key, e.i)
      if (Math.abs(e.ly - e.at) > 1) {
        s += `<line class="lead" x1="${PL + PLOTW}" y1="${e.at.toFixed(1)}" x2="${PL + PLOTW + 4}" y2="${e.ly.toFixed(1)}" stroke="${esc(color)}"/>`
      }
      s += `<text class="dl" x="${PL + PLOTW + 6}" y="${e.ly.toFixed(1)}" dy="3.5" fill="${esc(color)}">${esc(e.sr.label)}</text>`
    }
  }

  // The hover target and crosshair only exist when there is a script to drive them.
  if (opts.interactive !== false) {
    s += `<rect class="hit" x="${PL}" y="${PT}" width="${PLOTW}" height="${PLOTH}"/>`
    s += `<line class="cross" x1="0" y1="${PT}" x2="0" y2="${PT + PLOTH}"/>`
  }
  return s + '</svg>'
}

function legendOf(items: { label: string; color: string }[]): string {
  return `<div class="legend">${items.map(i =>
    `<span><i style="background:${esc(i.color)}"></i>${esc(i.label)}</span>`).join('')}</div>`
}

interface BuiltChart {
  id: string; title: string; caption: string; svg: string; legend: string
  model: ChartModel; colorFor: (k: string, i: number) => string
  /** y domain, handed to the tooltip so it can resolve the nearest line. */
  domain: [number, number]
}

function buildCharts(voyage: Voyage, types: ReadingType[], colorsOn: boolean, interactive = true): BuiltChart[] {
  const out: BuiltChart[] = []
  const holds = holdNumbers(voyage.holdCount)

  for (const rt of types) {
    const thresholds: Threshold[] | undefined = colorsOn && rt.colorRules
      ? [{ v: rt.colorRules.amber, kind: 'w' }, { v: rt.colorRules.red, kind: 'c' }]
      : undefined

    if (isSinglePoint(rt)) {
      // One line per hold — the natural read for a single-value type.
      const model = buildHoldSeries(voyage, rt, rt.points[0])
      const colorFor = (_k: string, i: number) => seriesColor(i)
      out.push({
        id: `t-${rt.id}`, title: `${rt.name} by hold`,
        caption: `${rt.unit ? `${rt.unit}. ` : ''}One line per hold across every monitoring round.`,
        svg: svgChart(`t-${rt.id}`, model, colorFor, { direct: true, thresholds, interactive }),
        legend: legendOf(model.series.map((s, i) => ({ label: s.label, color: seriesColor(i) }))),
        model, colorFor, domain: chartDomain(model, thresholds),
      })
      continue
    }

    // Multi-point: lead with the peak-per-hold summary, which is the question a
    // reader actually has ("is any hold heating?"), then one chart per hold.
    const peak = peakByHold(voyage, rt)
    if (peak.hasData) {
      const colorFor = (_k: string, i: number) => seriesColor(i)
      out.push({
        id: `peak-${rt.id}`, title: `Peak ${rt.name.toLowerCase()} by hold`,
        caption: `The highest of the ${rt.points.length} points in each hold, at every round.`,
        svg: svgChart(`peak-${rt.id}`, peak, colorFor, { direct: true, thresholds, interactive }),
        legend: legendOf(peak.series.map((s, i) => ({ label: s.label, color: seriesColor(i) }))),
        model: peak, colorFor, domain: chartDomain(peak, thresholds),
      })
    }

    const gmap = groupColors(rt)
    const byId = new Map(rt.points.map(p => [p.id, p]))
    const colorFor = (key: string, i: number) => {
      const g = byId.get(key)?.group
      return g ? (gmap.get(g) ?? NEUTRAL) : seriesColor(i)
    }
    for (const hold of holds) {
      if (!readingTypeAppliesToHold(rt, hold)) continue
      const model = buildPointSeries(voyage, rt, hold, 'all')
      if (!model.hasData) continue
      out.push({
        id: `${rt.id}-h${hold}`, title: `Hold ${hold} — ${rt.name.toLowerCase()}`,
        caption: gmap.size
          ? `All ${rt.points.length} points, coloured by location rather than by probe.${interactive ? ' Hover the chart for every reading at that round.' : ''}`
          : `All ${rt.points.length} points.${interactive
              ? ' Hover the chart for every reading at that round — beyond a handful of lines, colour alone cannot tell them apart.'
              : ' Beyond a handful of lines colour alone cannot separate them, so read individual figures from the table above.'}`,
        svg: svgChart(`${rt.id}-h${hold}`, model, colorFor, { thresholds, interactive }),
        // ALWAYS a key. Grouped points key by location; ungrouped ones list every
        // probe, because a chart of 21 unlabelled lines with no legend is unreadable.
        legend: gmap.size
          ? legendOf([...gmap].map(([label, color]) => ({ label, color })))
          : legendOf(model.series.map((s, i) => ({ label: s.label, color: colorFor(s.key, i) }))),
        model, colorFor, domain: chartDomain(model, thresholds),
      })
    }
  }
  return out
}

/** Derived series: the hottest point in each hold at each round. Presentation
 *  only — it reads through getReadingValue like everything else. */
function peakByHold(voyage: Voyage, rt: ReadingType): ChartModel {
  const timepoints = voyageTimepoints(voyage)
  const holds = holdNumbers(voyage.holdCount).filter(h => readingTypeAppliesToHold(rt, h))
  let hasData = false, yMin = Infinity, yMax = -Infinity

  const series = holds.map((hold, i) => ({
    key: `peak-${hold}`, label: `Hold ${hold}`, color: seriesColor(i),
    values: timepoints.map(tp => {
      let best: number | null = null
      for (const pt of rt.points) {
        const n = parseFloat(getReadingValue(voyage, tp.dateISO, tp.period, hold, rt.id, pt.id))
        if (Number.isFinite(n) && (best == null || n > best)) best = n
      }
      if (best != null) { hasData = true; if (best < yMin) yMin = best; if (best > yMax) yMax = best }
      return best
    }),
  }))
  if (!hasData) { yMin = 0; yMax = 1 } else if (yMin === yMax) { yMin -= 1; yMax += 1 }
  return { readingType: rt, subtitle: undefined, timepoints, series, yMin, yMax, hasData }
}

// ── document ────────────────────────────────────────────────────────────────

function styles(): string {
  return `
*{box-sizing:border-box}
body{margin:0;background:#f1f3f7;color:#0f172a;font-family:Inter,"Segoe UI",system-ui,-apple-system,sans-serif;
  font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;font-feature-settings:'cv11','ss01'}
.wrap{max-width:1500px;margin:0 auto;padding:28px 20px 64px;display:flex;flex-direction:column;gap:20px}
.lh{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap;
  padding-bottom:14px;border-bottom:2px solid #1d4ed8}
.lh img{width:250px;max-width:52vw;height:auto;display:block}
.lh .wm{font-size:19px;font-weight:700;color:#1d4ed8;letter-spacing:.01em}
.lh .tg{font-size:8.5px;letter-spacing:.14em;color:#64748b;margin-top:2px}
.lh-c{text-align:right;font-size:11px;color:#475569;line-height:1.65}
h1{font-size:22px;font-weight:640;letter-spacing:-.015em;margin:0;text-wrap:balance}
.sub{color:#475569;margin:3px 0 0;font-size:13.5px}
.note{display:flex;gap:10px;align-items:flex-start;padding:11px 14px;border-radius:8px;font-size:12.5px}
.note.prelim{background:#fef9c3;color:#854d0e;border:1px solid #eab30840}
.note.final{background:#dcfce7;color:#166534;border:1px solid #16a34a40}
/* Five columns, two rows: identity and route on top, timing and people below.
   auto-fit chose its own column count from the viewport and left a hole in the
   last row whenever the item count didn't divide by it. Fixed at 5 and centred,
   because the block is a caption for the document, not a full-bleed table. */
.meta{display:grid;grid-template-columns:repeat(5,1fr);max-width:1160px;margin:0 auto;width:100%;
  background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;
  box-shadow:0 1px 2px rgb(15 23 42/.06),0 8px 24px -12px rgb(15 23 42/.18)}
.meta div{padding:10px 14px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;min-width:0}
.meta div:nth-child(5n){border-right:0}
/* An optional field (client, report reference) can leave the last row short.
   The final cell stretches over the remainder so the row still closes flush
   instead of trailing an empty box. */
.f2{grid-column:span 2}.f3{grid-column:span 3}.f4{grid-column:span 4}.f5{grid-column:span 5}
.meta dt{font-size:10.5px;text-transform:uppercase;letter-spacing:.075em;color:#8a95a6;margin:0 0 2px}
.meta dd{margin:0;font-weight:560;font-size:13.5px;overflow-wrap:anywhere}
h2.sec{font-size:15px;font-weight:640;margin:8px 0 0;padding-bottom:8px;border-bottom:2px solid #1d4ed8;color:#0f172a}
.tabs{display:flex;gap:2px;border-bottom:1px solid #e2e8f0}
.tabs button{appearance:none;background:none;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;
  padding:9px 16px;font:inherit;font-weight:560;color:#475569;cursor:pointer;border-radius:7px 7px 0 0;
  transition:color .15s,background .15s,border-color .15s}
.tabs button:hover{color:#0f172a;background:#f8fafc}
.tabs button[aria-selected="true"]{color:#1d4ed8;border-bottom-color:#1d4ed8;background:#eef2ff}
.tabs button:focus-visible{outline:2px solid #1d4ed8;outline-offset:-2px}
[role="tabpanel"][hidden]{display:none}
.key{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;font-size:12px;color:#475569}
.key span{display:inline-flex;align-items:center;gap:6px}
.key i{width:22px;height:13px;border-radius:3px;display:inline-block;border:1px solid rgb(15 23 42/.1)}
.hint{font-size:12px;color:#8a95a6}
.pane{background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:auto;max-height:78vh;
  overscroll-behavior:contain;box-shadow:0 1px 2px rgb(15 23 42/.06),0 8px 24px -12px rgb(15 23 42/.18)}
table.grid{border-collapse:separate;border-spacing:0;font-variant-numeric:tabular-nums;font-size:11.5px;white-space:nowrap}
thead th{position:sticky;background:#1e3a8a;color:#fff;font-weight:560;z-index:3}
tr.r-date th{top:0;height:30px;font-size:11px;padding:0 6px;
  box-shadow:inset -1px 0 0 rgb(255 255 255/.16),inset 0 -1px 0 rgb(255 255 255/.16)}
tr.r-date th b{display:block;font-weight:640}
tr.r-date th.d-extra{background:#24468f}
/* Must match tbody th.s exactly — they are the same sticky column. */
tr.r-date th.corner{left:0;top:0;z-index:5;width:196px;min-width:196px;text-align:left;padding:0 10px;
  vertical-align:middle;height:auto;box-shadow:inset -1px 0 0 rgb(255 255 255/.22),inset 0 -1px 0 rgb(255 255 255/.18)}
.corner-t{display:block;font-weight:640;font-size:12px}
.corner-s{display:block;font-size:9px;opacity:.6;letter-spacing:.05em;text-transform:uppercase}
tr.r-round th{top:30px;height:21px;font-size:10.5px;padding:0 5px;box-shadow:inset -1px 0 0 rgb(255 255 255/.12)}
tr.r-round th.extra{color:#ffd88a}
tr.r-actual th{top:51px;height:19px;font-size:9.5px;font-weight:400;color:#b9c9ea;background:#1a2f66;
  box-shadow:inset -1px 0 0 rgb(255 255 255/.1),inset 0 -1px 0 rgb(255 255 255/.18)}
tr.band th{position:sticky;top:70px;z-index:4;text-align:left;padding:6px 12px;font-size:12.5px;font-weight:640;
  background:#eef2ff;color:#1d4ed8;box-shadow:inset 0 1px 0 #cbd5e1,inset 0 -1px 0 #cbd5e1}
.stick{position:sticky;left:12px;display:inline-block}
tbody th.s{position:sticky;left:0;z-index:2;background:#fff;text-align:left;font-weight:500;padding:0 10px;
  height:22px;width:196px;min-width:196px;font-size:11.5px;
  box-shadow:inset -1px 0 0 #cbd5e1,inset 0 -1px 0 #e2e8f0}
/* One line, always: the label takes the room and the unit sits against the
   right edge. The label ellipsises rather than pushing the unit onto a second
   line and making the row two deep. */
.sw{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0;line-height:22px}
.sw b{font-weight:inherit;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.sw em{flex:none;font-style:normal;font-size:9px;letter-spacing:.05em;color:#8a95a6}
/* Every reading TYPE is a title at the same level, in the label column —
   whether or not it has channels beneath it. Oxygen names what is measured
   exactly as much as Infrared gun does. */
tr.tt th.s{font-weight:660;color:#0f172a}
/* Channels of a multi-point type, indented under their title. */
tr.pt th.s{padding-left:22px;color:#334155}
/* A title with channels below holds no readings of its own. */
td.fill{background:#fbfcfe;box-shadow:inset 0 -1px 0 #e2e8f0}
/* Real separation between types. A border rather than padding, so a coloured
   value cell never bleeds its tint up into the gap. */
tr.gap>th,tr.gap>td{border-top:9px solid #eef1f5}
tbody td{height:22px;min-width:52px;padding:0 6px;text-align:center;box-shadow:inset -1px 0 0 #e2e8f0,inset 0 -1px 0 #e2e8f0}
tbody tr:hover td{filter:brightness(.97)}
td.plain{background:#fff;color:#475569}
td.ok{background:${GREEN_BG};color:#166534}
td.warn{background:${AMBER_BG};color:#854d0e;font-weight:600}
td.crit{background:${RED_BG};color:#991b1b;font-weight:660}

/* ── day banding ──────────────────────────────────────────────────────────
   Alternate days carry a barely-there tint so a run of forty-odd columns reads
   as days. It is applied ONLY to cells with no threshold colour: tinting an
   amber or red cell would change what the threshold looks like depending on
   which day it fell on, which is not a thing to do in a document about cargo
   that is heating. The day-opening rule below is what carries the banding
   across the coloured rows, where a tint deliberately cannot go. */
td.plain.alt{background:#f6f8fc}
td.fill.alt{background:#f5f7fb}
th.alt{background:#1a336f}
tr.r-actual th.alt{background:#16295c}
/* First column of a day — a heavier rule, legible whatever the cell colour. */
tbody td.ds{box-shadow:inset 1px 0 0 #94a3b8,inset -1px 0 0 #e2e8f0,inset 0 -1px 0 #e2e8f0}
/* Scoped per header row so each keeps the bottom rule it had — a blanket
   thead th.ds would drop r-actual's underline and invent one on r-round. */
tr.r-round th.ds{box-shadow:inset 1px 0 0 rgb(255 255 255/.5),inset -1px 0 0 rgb(255 255 255/.12)}
tr.r-actual th.ds{box-shadow:inset 1px 0 0 rgb(255 255 255/.5),inset -1px 0 0 rgb(255 255 255/.1),inset 0 -1px 0 rgb(255 255 255/.18)}
.charts{display:flex;flex-direction:column;gap:18px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px 12px;
  box-shadow:0 1px 2px rgb(15 23 42/.06),0 8px 24px -12px rgb(15 23 42/.18)}
.card h2{font-size:14.5px;font-weight:620;margin:0}
.card p.cap{margin:2px 0 10px;font-size:12px;color:#475569}
.chart{width:100%;height:auto;display:block;overflow:visible;touch-action:pan-y}
.gl{stroke:#eef1f5;stroke-width:1}.gv{stroke:#e6eaf0;stroke-width:1}
.tick{fill:#94a3b8;font-size:9.5px;font-variant-numeric:tabular-nums}
.ln{fill:none;stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round}
.dl{font-size:10.5px;font-weight:600}.lead{stroke-width:1;opacity:.55}
.thr{stroke-width:1;stroke-dasharray:5 4}.thr-w{stroke:#d9a441}.thr-c{stroke:#dc2626}
.thr-t{font-size:9.5px;font-weight:600;stroke:none}
text.thr-w{fill:#a97c1e}text.thr-c{fill:#dc2626}
.hit{fill:transparent;cursor:crosshair}
.cross{stroke:#8a95a6;stroke-width:1;stroke-dasharray:3 3;opacity:0;pointer-events:none}
.chart.on .cross{opacity:.75}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:8px;font-size:11.5px;color:#475569}
.legend span{display:inline-flex;align-items:center;gap:6px}
.legend i{width:14px;height:3px;border-radius:2px}
.none{font-size:12.5px;color:#8a95a6;padding:10px 0}
.obs{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;white-space:pre-wrap;font-size:13px}
.obs h2{font-size:14.5px;font-weight:620;margin:0 0 8px}
.tip{position:fixed;z-index:60;pointer-events:none;opacity:0;transform:translateY(3px);
  transition:opacity .12s,transform .12s;background:#fff;border:1px solid #cbd5e1;border-radius:9px;
  box-shadow:0 1px 2px rgb(15 23 42/.06),0 10px 30px -12px rgb(15 23 42/.3);padding:8px 10px;
  font-size:11.5px;font-variant-numeric:tabular-nums;min-width:150px}
.tip.on{opacity:1;transform:translateY(0)}
.tip b{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#8a95a6;
  font-weight:600;margin-bottom:5px}
.tip .rows{display:grid;grid-template-columns:1fr;gap:0 18px}
/* Past a dozen probes a single column runs off the screen, so it splits. */
.tip.wide{min-width:290px}
.tip.wide .rows{grid-template-columns:1fr 1fr}
.tip u{display:flex;justify-content:space-between;gap:14px;text-decoration:none;padding:1.5px 0}
.tip u i{width:9px;height:9px;border-radius:2px;flex:none;margin-right:6px;align-self:center}
.tip u span{display:flex;align-items:center;min-width:0}
/* The line the pointer is on. With 21 overlapping probes no palette can
   separate them, so the tooltip is what identifies the one under the cursor. */
.tip u.hi{background:#eef2ff;border-radius:4px;margin:0 -5px;padding:1.5px 5px;font-weight:660;color:#1d4ed8}
footer{color:#8a95a6;font-size:11.5px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;
  border-top:1px solid #e2e8f0;padding-top:12px}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
/* Below the desktop width the five columns stop fitting. The span classes are
   reset here so a stretched final cell can't drag a narrow layout out of shape;
   .meta>div outranks .f2-.f5 on specificity, so no !important is needed. */
@media (max-width:1023px){
  .meta{grid-template-columns:repeat(3,1fr);max-width:none}
  .meta>div{grid-column:auto}
  .meta div:nth-child(5n){border-right:1px solid #e2e8f0}
  .meta div:nth-child(3n){border-right:0}
}
@media (max-width:640px){
  .wrap{padding:16px 10px 44px}.lh-c{text-align:left}.pane{max-height:70vh}
  .meta{grid-template-columns:repeat(2,1fr)}
  .meta div:nth-child(3n){border-right:1px solid #e2e8f0}
  .meta div:nth-child(2n){border-right:0}
}
`.trim()
}

// Tab switching. Always shipped — the Charts panel starts `hidden` and would be
// unreachable without it, in every copy of this document.
const TAB_SCRIPT = `
var tabs=[].slice.call(document.querySelectorAll('.tabs button'));
tabs.forEach(function(b){b.addEventListener('click',function(){
  tabs.forEach(function(o){o.setAttribute('aria-selected',String(o===b))});
  [].forEach.call(document.querySelectorAll('[role=tabpanel]'),function(p){p.hidden=p.id!==b.dataset.panel});
})});
`.trim()

// The chart hover readout. Omitted from the emailed snapshot along with its data
// payload — see AnnexOptions.interactive.
const HOVER_SCRIPT = `
var V=__P__,tip=document.getElementById('tip');
function show(chart,e){
  var d=V.c[chart.dataset.chart];if(!d)return;
  var box=chart.getBoundingClientRect(),vb=chart.viewBox.baseVal,n=V.t.length;
  var xu=(e.clientX-box.left)/box.width*vb.width;
  var yu=(e.clientY-box.top)/box.height*vb.height;
  var i=Math.round((xu-${PL})/${PLOTW}*(n-1));i=Math.max(0,Math.min(n-1,i));
  var x=${PL}+(i/(n-1))*${PLOTW},c=chart.querySelector('.cross');
  c.setAttribute('x1',x);c.setAttribute('x2',x);chart.classList.add('on');

  // EVERY series at this round, hottest first — with 21 probes overlapping, the
  // tooltip is what identifies them, not the palette.
  var rows=[],nearest=null,best=1e9;
  for(var k=0;k<d.s.length;k++){
    var v=d.s[k].v[i];if(v==null)continue;
    var y=${PT}+${PLOTH}-((v-d.lo)/(d.hi-d.lo))*${PLOTH};
    var row={l:d.s[k].l,c:d.s[k].c,v:v,hit:false},dist=Math.abs(y-yu);
    if(dist<best){best=dist;nearest=row}
    rows.push(row);
  }
  // Mark the line the pointer is actually on — that is what answers "which one
  // is this". Only when genuinely close, or the mark would be a guess.
  if(nearest&&best<14)nearest.hit=true;
  rows.sort(function(a,b){return b.v-a.v});
  var html='<b>'+V.t[i]+'</b>';
  if(!rows.length){html+='<div class="rows"><u><span>No reading</span></u></div>'}
  else{
    html+='<div class="rows">'+rows.map(function(r){
      return'<u'+(r.hit?' class="hi"':'')+'><span><i style="background:'+r.c+'"></i>'+r.l+'</span><span>'+r.v+'</span></u>'
    }).join('')+'</div>'
  }
  tip.innerHTML=html;
  tip.classList.toggle('wide',rows.length>12);
  tip.classList.add('on');
  var tw=tip.offsetWidth,th=tip.offsetHeight,tx=e.clientX+16;
  if(tx+tw>innerWidth-8)tx=e.clientX-tw-16;
  tip.style.left=Math.max(8,tx)+'px';
  tip.style.top=Math.max(8,Math.min(innerHeight-th-8,Math.max(8,e.clientY-th/2)))+'px';
}
[].forEach.call(document.querySelectorAll('.chart'),function(ch){
  var hit=ch.querySelector('.hit');if(!hit)return;
  hit.addEventListener('pointermove',function(e){show(ch,e)});
  hit.addEventListener('pointerleave',function(){ch.classList.remove('on');tip.classList.remove('on')});
});
`.trim()

/** Render the whole annex. Pure: same voyage in, same document out. */
export function renderVoyageAnnex(voyage: Voyage, opts: AnnexOptions = {}): string {
  const generatedAt = opts.generatedAt ?? new Date()
  const interactive = opts.interactive !== false
  // Fall back to the document's own updatedAt when the caller doesn't supply one,
  // so the age is stated even from a plain render.
  const asAt = stamp(opts.dataAsAt ?? voyage.updatedAt ?? null)
  const received = stamp(opts.receivedAt ?? null)
  const colorsOn = voyage.showColors !== false
  const tableTypes = (voyage.readingTypes ?? []).filter(rt => rt.includeInTables)
  const chartTypes = (voyage.readingTypes ?? []).filter(rt => rt.includeInCharts)
  const omitted = (voyage.readingTypes ?? []).filter(rt => !rt.includeInTables && !rt.includeInCharts)
  const tps = voyageTimepoints(voyage)
  const finalized = voyage.status === 'finalized'
  const vessel = withVesselPrefix(voyage.vesselName, voyage.vesselType)
  const charts = buildCharts(voyage, chartTypes, colorsOn, interactive)

  const meta: [string, string][] = [
    ['Vessel', vessel],
    ['Voyage number', displayVoyageNumber(voyage.voyageNumber) || '—'],
    ['Cargo', voyage.cargoType || '—'],
    ['Loading port', voyage.loadingPort || '—'],
    ['Discharge port', voyage.dischargePort || '—'],
    ['Monitoring commenced', voyage.startDate ? formatVoyageDate(voyage.startDate) : '—'],
    ['Monitoring completed', voyage.endDate ? formatVoyageDate(voyage.endDate) : 'In progress'],
    ['Holds monitored', String(voyage.holdCount ?? '—')],
    ['Surveyor', voyage.surveyorName || '—'],
  ]
  if (voyage.clientName) meta.push(['Client', voyage.clientName])
  if (opts.reportNumber) meta.push(['Report reference', opts.reportNumber])

  // Tooltip payload: only the charts actually rendered, values rounded. The y
  // domain travels with each chart so the tooltip can work out which line the
  // pointer is nearest — the answer to "which one is which" when 21 probes
  // overlap and no palette could separate them.
  const payload = {
    t: tps.map(tp => `${dayLabel(tp.dateISO)} · ${tp.period}`),
    c: Object.fromEntries(charts.map(c => [c.id, {
      lo: Math.round(c.domain[0] * 100) / 100,
      hi: Math.round(c.domain[1] * 100) / 100,
      s: c.model.series.map((s, i) => ({
        l: s.label, c: c.colorFor(s.key, i),
        v: s.values.map(v => (v == null ? null : Math.round(v * 10) / 10)),
      })),
    }])),
  }

  const letterhead = opts.logoDataUrl
    ? `<img src="${opts.logoDataUrl}" alt="${esc(COMPANY.name)}">`
    : `<div><div class="wm">${esc(COMPANY.name)}</div><div class="tg">${esc(COMPANY.tagline)}</div></div>`

  const body = `<div class="wrap">
<header class="lh">${letterhead}
  <div class="lh-c">${esc(COMPANY.address)}<br>
    T ${esc(COMPANY.phone)} &nbsp; ${esc(COMPANY.phoneAlt)} &nbsp;&middot;&nbsp; F ${esc(COMPANY.fax)}<br>
    E ${esc(COMPANY.email)}</div>
</header>

<div class="note ${finalized ? 'final' : 'prelim'}">
  <span>${finalized ? '&#10003;' : '&#9888;'}</span>
  <div>${finalized
    ? `This report has been finalised.${asAt ? ` Readings are complete to <strong>${esc(asAt)}</strong>.` : ''}`
    : `<b>Preliminary &mdash; monitoring is ongoing.</b> ${asAt
        ? `These readings are as at <strong>${esc(asAt)}</strong>.${opts.selfContained
            ? ' Monitoring continues, so later rounds will appear on a subsequent report.'
            : ' Monitoring continues at sea, where there is often no signal, so anything recorded since has not yet reached us and is not shown here.'}`
        : 'Figures are current as at the surveyor&rsquo;s last sync and may change.'}`}</div>
</div>

${/* Just the heading. The vessel, voyage and ports used to be repeated here as a
     subtitle, but every one of them is already a labelled field in the block
     below — saying it twice adds nothing and makes the reader check whether the
     two copies agree. */''}
<h1>Cargo Monitoring &mdash; Data Annex</h1>

<dl class="meta">${meta.map(([k, v], i) => {
    // Close the last row: if the count doesn't divide by five, the final cell
    // takes the slack rather than leaving a gap beside it.
    const slack = (5 - (meta.length % 5)) % 5
    const cls = slack && i === meta.length - 1 ? ` class="f${slack + 1}"` : ''
    return `<div${cls}><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`
  }).join('')}</dl>

${interactive ? `<div class="tabs" role="tablist">
  <button role="tab" aria-selected="true" data-panel="p-r">Readings</button>
  <button role="tab" aria-selected="false" data-panel="p-c">Charts</button>
</div>` : '<h2 class="sec">Readings</h2>'}

<section id="p-r"${interactive ? ' role="tabpanel"' : ''}>
  <div style="display:flex;flex-direction:column;gap:12px">
    <div class="key">${colorsOn
      ? `<span><i style="background:${GREEN_BG}"></i>Normal</span>
         <span><i style="background:#eef7cd"></i>Rising &mdash; shaded by 24&nbsp;h rate of rise</span>
         <span><i style="background:${AMBER_BG}"></i>At the warning threshold</span>
         <span><i style="background:${RED_BG}"></i>At the critical threshold</span>`
      /* Colours off: say nothing. The reader has no need to know a setting was
         turned off, and naming it only invites the question. */
      : ''}
      <span class="hint">Scroll right for the full voyage &middot; scroll down for every hold. Labels stay pinned.</span>
    </div>
    ${tableTypes.length && tps.length ? `<div class="pane">${readingsGrid(voyage, tps, tableTypes)}</div>`
      : '<p class="none">No readings have been recorded for this voyage yet.</p>'}
    ${omitted.length ? `<p class="hint">Also recorded on this voyage but not included here: ${
      omitted.map(rt => `${esc(rt.name)}${rt.unit ? ` (${esc(rt.unit)})` : ''}`).join(', ')}.</p>` : ''}
  </div>
</section>

${interactive ? '' : '<h2 class="sec">Charts</h2>'}
<section id="p-c"${interactive ? ' role="tabpanel" hidden' : ''}>
  <div class="charts">${charts.length ? charts.map(c => `<div class="card">
    <h2>${esc(c.title)}</h2><p class="cap">${esc(c.caption)}</p>${c.svg}${c.legend}</div>`).join('')
    : '<p class="none">No charts &mdash; no reading type on this voyage is set to appear in charts.</p>'}
  </div>
</section>

${voyage.observations ? `<div class="obs"><h2>Surveyor&rsquo;s observations</h2>${esc(voyage.observations)}</div>` : ''}

<footer>
  <span>${esc(COMPANY.name)} &mdash; ${esc(COMPANY.confidential)}</span>
  ${/* The DATA's age leads. The render time follows, plainly labelled, so it can
       never be mistaken for the age of the figures. */''}
  <span>${asAt ? `Readings as at ${esc(asAt)}` : 'Readings as at the surveyor&rsquo;s last sync'}${
    received ? ` &middot; received ${esc(received)}` : ''} &middot; page opened ${esc(stamp(generatedAt) ?? '')}</span>
</footer>
</div>
${interactive ? '<div class="tip" id="tip"></div>' : ''}`

  // JSON is embedded in a <script>; "</script>" inside a string would close the
  // block early, so the closing angle bracket is escaped.
  const json = JSON.stringify(payload).replace(/</g, '\\u003c')
  // The emailed copy carries NO JavaScript at all. Its Charts section is a plain
  // visible block rather than a hidden tab panel, so there is nothing left for a
  // script to reveal — and a recipient whose mail client or viewer blocks
  // scripts still sees the whole document rather than half of it.
  //
  // The payload goes in via a FUNCTION replacement, not a string: `$&`, `$'` and
  // "$`" inside a surveyor's vessel or point name would otherwise be read by
  // String.replace as replacement patterns, corrupting the JSON and taking the
  // entire script — tab switching included — down with it.
  const script = interactive
    ? `${TAB_SCRIPT}\n${HOVER_SCRIPT.replace('__P__', () => json)}`
    : ''

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
${/* The vessel stays in the browser title (not on the page): it names the tab,
     the bookmark and the file if the recipient saves the page, and several of
     these open side by side. */''}
<title>${esc(vessel)} — Cargo Monitoring Data Annex</title>
<style>${styles()}</style></head><body>${body}
${script ? `<script>${script}</script>` : ''}</body></html>`
}
