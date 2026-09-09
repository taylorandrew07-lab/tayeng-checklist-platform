import React from 'react'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { COMPANY } from '@/lib/company'

// The monthly Labour & Overtime sheet, shift by shift — the printable twin of the
// Finance → Overview labour panel. One section per surveyor: every dated shift with its
// vessel, times, regular-vs-overtime quantity and km, then that surveyor's subtotal,
// under a company totals band.
//
// TWO VARIANTS, ONE GRID. `withPay` prints the pay run (admin only); with it off the
// document carries no pay anywhere — absent, not blank — so it is safe to circulate.
// The columns are identical either way, so the office can lay the two sheets side by
// side and tick rows across.
//
// EVERY PROP IS A PREFORMATTED STRING. This file does no formatting and holds no
// quantity: it never decides "h" versus "d", never adds an hours quantity to a days one
// and never sees a number it could. All of that lives in lib/jobs/labourReport.ts, which
// gets its unit wording from lib/jobs/labourUnit.ts. Same contract as SurveyorStatementPDF
// (whose premise is that it is NOT a pay statement — this is the file that is one, which
// is why it is its own renderer rather than a branch in that one).
//
// KNOWN LIMIT: a surveyor with more rows than one landscape page (~31) continues onto
// the next page WITHOUT a repeated column header. The per-row borders still close the
// box on whichever row the break lands, and every row carries its own date and vessel,
// so a continued page still reads. A `fixed` header is not usable here — it would print
// above the page-1 letterhead too.

const BRAND = '#1d4ed8'
const INK = '#1e293b'
const MUTE = '#64748b'
const LINE = '#cbd5e1'
const WARN = '#b91c1c'

/** @react-pdf hyphenates by default and its guesses are not syllable breaks
 *  ("M.V. Del-/ta Van-/guard"). The prop-level lever is scoped to the one element;
 *  the `Font.registerHyphenationCallback` global is process-wide and would leak into a
 *  concurrent render. Spread onto every cell that can wrap. */
const KEEP_WHOLE = (word: string): string[] => [word]
const noHyphen = { hyphenationCallback: KEEP_WHOLE }

const s = StyleSheet.create({
  // A4 LANDSCAPE. The fixed columns below total 550pt against A4 portrait's 507.28pt of
  // usable width, so portrait cannot fit them and would squeeze the vessel column below
  // the ~118pt that real Trinidad vessel names need on one line.
  //
  // Deliberately NO lineHeight on the page. A page-level lineHeight collapses the auto
  // height of `fixed`/absolute boxes: their contents are dropped and a `render` callback
  // emits nothing at all — which is why SurveyorStatementPDF's confidential line and page
  // number do not print today. Set lineHeight per Text if it is ever needed.
  page: { fontFamily: 'Helvetica', fontSize: 9, color: INK, paddingTop: 34, paddingBottom: 44, paddingHorizontal: 44 },

  // Letterhead — page 1 only, not fixed.
  wordmark: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: BRAND, textAlign: 'center', letterSpacing: 0.3 },
  tagline: { fontSize: 7.5, color: MUTE, textAlign: 'center', letterSpacing: 1.4, marginTop: 2 },
  headLine: { fontSize: 8, color: MUTE, textAlign: 'center', marginTop: 2 },
  rule: { borderBottomWidth: 1.5, borderBottomColor: BRAND, marginTop: 8, marginBottom: 12 },
  title: { fontSize: 13, fontFamily: 'Helvetica-Bold', letterSpacing: 1, textAlign: 'center', marginBottom: 10 },

  meta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  metaCol: { flexDirection: 'column' },
  metaLabel: { fontSize: 7.5, color: MUTE, letterSpacing: 0.6 },
  metaVal: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: INK },

  // Company totals band.
  totals: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  totalCard: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: '6 8' },
  totalLabel: { fontSize: 7.5, color: MUTE, letterSpacing: 0.6 },
  totalVal: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: INK, marginTop: 1 },

  footnote: { fontSize: 7.5, color: MUTE, marginBottom: 12, lineHeight: 1.35 },

  // Reconciliation warning — normally absent.
  warnBox: { borderWidth: 1, borderColor: WARN, borderRadius: 4, padding: '6 8', marginBottom: 12 },
  warnHead: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: WARN, letterSpacing: 0.6, marginBottom: 2 },
  warnLine: { fontSize: 8, color: WARN },

  // Surveyor section head.
  surHead: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 4 },
  surName: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: INK, flex: 1 },
  chips: { flexDirection: 'row', gap: 6, alignItems: 'flex-end' },
  chip: { fontSize: 8, color: MUTE },
  chipVal: { fontFamily: 'Helvetica-Bold', color: INK },

  // The box is drawn PER ROW, not on the table container: a single container border is
  // painted around the whole block, so wherever a page break lands the box comes out
  // open-ended. Every row carrying its own left/right/bottom edge closes it.
  table: {},
  thead: {
    flexDirection: 'row', backgroundColor: '#f1f5f9',
    borderTopWidth: 1, borderTopColor: INK, borderBottomWidth: 1, borderBottomColor: INK,
    borderLeftWidth: 1, borderLeftColor: INK, borderRightWidth: 1, borderRightColor: INK,
  },
  th: { padding: '4 6', fontFamily: 'Helvetica-Bold', fontSize: 8 },
  bodyRow: {
    flexDirection: 'row', minHeight: 16,
    borderLeftWidth: 1, borderLeftColor: INK, borderRightWidth: 1, borderRightColor: INK,
    borderBottomWidth: 1, borderBottomColor: INK,
  },
  // No borderTop: the row above already draws its own bottom edge, and two adjacent
  // borders render as a doubled rule rather than collapsing into one.
  subRow: {
    flexDirection: 'row', backgroundColor: '#f8fafc',
    borderLeftWidth: 1, borderLeftColor: INK, borderRightWidth: 1, borderRightColor: INK,
    borderBottomWidth: 1, borderBottomColor: INK,
  },
  td: { padding: '3 6', fontSize: 9 },
  tdTot: { padding: '4 6', fontSize: 9, fontFamily: 'Helvetica-Bold' },

  // Fixed widths total 550pt; the vessel column takes the remaining ~204pt.
  cDate: { width: 62 },
  cSpan: { width: 96 },
  cVessel: { flex: 1 },
  cJob: { width: 78 },
  cClient: { width: 96 },
  cReg: { width: 52, textAlign: 'right' },
  cOt: { width: 52, textAlign: 'right' },
  cKm: { width: 44, textAlign: 'right' },
  cFlag: { width: 70, fontSize: 7.5, color: MUTE },

  // The end DATE of a shift that rolled past midnight, under its times.
  spanEnd: { fontSize: 7, color: MUTE },

  // An explicit height is load-bearing: anchored by `bottom` with an auto height the box
  // resolves to a single line and clips everything above it away.
  footer: { position: 'absolute', bottom: 22, left: 44, right: 44, height: 32 },
  footerConf: { textAlign: 'center', fontSize: 7.5, color: MUTE },
  // Its own node on the page, not a child of the footer — nested inside that box the
  // per-page render callback yields nothing. `fixed` is required on any node carrying
  // a `render` callback, or it is only evaluated once.
  footerPageNo: { position: 'absolute', bottom: 22, right: 44, fontSize: 7.5, color: MUTE },
})

export interface LabourReportPdfRow {
  date: string
  vessel: string
  job: string
  client: string
  /** '08:00 – 17:00' · 'travel' · '—'. */
  span: string
  /** 'ends 21 Aug' when the shift rolled past midnight; '' otherwise. */
  spanEnd: string
  reg: string
  ot: string
  km: string
  flag: string
}

export interface LabourReportPdfSurveyor {
  name: string
  rows: LabourReportPdfRow[]
  totalReg: string
  totalOt: string
  totalKm: string
  /** Shift count, e.g. '14'. */
  shifts: string
  /** '' when the variant is quantities-only. */
  payLabel: string
}

export interface LabourReportPdfProps {
  periodLabel: string
  generatedLabel: string
  withPay: boolean
  surveyors: LabourReportPdfSurveyor[]
  totalReg: string
  totalOt: string
  totalKm: string
  surveyorCount: string
  /** '' when the variant is quantities-only. */
  companyPayLabel: string
  /** One line per surveyor total that disagrees with the Finance Overview panel.
   *  Usually empty. */
  warnings: string[]
}

function Chip({ label, value }: { label: string; value: string }) {
  return <Text style={s.chip}>{label} <Text style={s.chipVal}>{value}</Text></Text>
}

export function LabourReportPDF({
  periodLabel, generatedLabel, withPay, surveyors,
  totalReg, totalOt, totalKm, surveyorCount, companyPayLabel, warnings,
}: LabourReportPdfProps) {
  return (
    <Document
      title={`Labour & overtime — ${periodLabel}`}
      author={COMPANY.name}
      subject={withPay ? 'Labour & overtime pay run' : 'Labour & overtime — shift detail'}
    >
      <Page size="A4" orientation="landscape" style={s.page}>
        <Text style={s.wordmark}>{COMPANY.name}</Text>
        <Text style={s.tagline}>{COMPANY.tagline}</Text>
        <Text style={s.headLine}>{COMPANY.address}</Text>
        <View style={s.rule} />

        <Text style={s.title}>{withPay ? 'LABOUR & OVERTIME — PAY RUN' : 'LABOUR & OVERTIME — SHIFT DETAIL'}</Text>

        <View style={s.meta}>
          <View style={s.metaCol}><Text style={s.metaLabel}>PERIOD</Text><Text style={s.metaVal}>{periodLabel}</Text></View>
          <View style={[s.metaCol, { alignItems: 'center' }]}><Text style={s.metaLabel}>GENERATED</Text><Text style={s.metaVal}>{generatedLabel}</Text></View>
          <View style={[s.metaCol, { alignItems: 'flex-end' }]}><Text style={s.metaLabel}>SURVEYORS</Text><Text style={s.metaVal}>{surveyorCount}</Text></View>
        </View>

        <View style={s.totals}>
          <View style={s.totalCard}><Text style={s.totalLabel}>REGULAR</Text><Text style={s.totalVal}>{totalReg}</Text></View>
          <View style={s.totalCard}><Text style={s.totalLabel}>OVERTIME</Text><Text style={s.totalVal}>{totalOt}</Text></View>
          <View style={s.totalCard}><Text style={s.totalLabel}>DISTANCE</Text><Text style={s.totalVal}>{totalKm}</Text></View>
          <View style={s.totalCard}><Text style={s.totalLabel}>SURVEYORS</Text><Text style={s.totalVal}>{surveyorCount}</Text></View>
          {withPay && companyPayLabel
            ? <View style={s.totalCard}><Text style={s.totalLabel}>PAY</Text><Text style={s.totalVal}>{companyPayLabel}</Text></View>
            : null}
        </View>

        <Text style={s.footnote}>
          Quantities are shown per unit and are never added together. Overtime shifts and km trips count on the day
          they were worked or driven; regular quantities (and a day-billed job&apos;s typed overtime) count in the month
          the job is scheduled — so a shift dated just outside this period can belong to a job inside it. On a
          day-billed job the payable quantity is the typed day count and every shift printed against it is a
          &quot;shift record, not payable&quot; — the hours worked, not the money. A line marked &quot;no shift log&quot; is a
          typed quantity with no shift recorded behind it at all.
        </Text>

        {warnings.length > 0 && (
          <View style={s.warnBox}>
            {/* No arrow anywhere on this page. Helvetica is a standard-14 font with
                WinAnsiEncoding and U+2192 is not in it: @react-pdf neither throws nor
                drops it, it writes the low byte, so the one banner that exists to be
                believed would print "FINANCE ' OVERVIEW". The en dash, the em dash and
                the middot ARE in WinAnsi and are safe. */}
            <Text style={s.warnHead}>DOES NOT RECONCILE WITH THE FINANCE OVERVIEW PANEL</Text>
            {warnings.map((w, i) => <Text key={i} style={s.warnLine}>{w}</Text>)}
          </View>
        )}

        {surveyors.map((sv, i) => (
          // Each surveyor starts a fresh page, so the page IS that person's sheet.
          // NEVER wrap the whole block in wrap={false} — a block taller than the page
          // cannot be honoured and would overflow off the bottom.
          <View key={sv.name + i} break={i > 0}>
            <View style={s.surHead} wrap={false} minPresenceAhead={110}>
              <Text style={s.surName}>{sv.name}</Text>
              <View style={s.chips}>
                <Chip label="Regular" value={sv.totalReg} />
                <Chip label="Overtime" value={sv.totalOt} />
                <Chip label="Distance" value={sv.totalKm} />
                <Chip label="Shifts" value={sv.shifts} />
                {withPay && sv.payLabel ? <Chip label="Pay" value={sv.payLabel} /> : null}
              </View>
            </View>

            <View style={s.table}>
              <View style={s.thead}>
                <Text style={[s.th, s.cDate]}>Date</Text>
                <Text style={[s.th, s.cSpan]}>Shift</Text>
                <Text style={[s.th, s.cVessel]}>Vessel</Text>
                <Text style={[s.th, s.cJob]}>Report / Job</Text>
                <Text style={[s.th, s.cClient]}>Client</Text>
                <Text style={[s.th, s.cReg]}>Regular</Text>
                <Text style={[s.th, s.cOt]}>Overtime</Text>
                <Text style={[s.th, s.cKm]}>Km</Text>
                <Text style={[s.th, s.cFlag]} />
              </View>

              {sv.rows.map((r, j) => (
                <View key={j} style={s.bodyRow} wrap={false}>
                  <Text style={[s.td, s.cDate]}>{r.date}</Text>
                  <View style={[s.td, s.cSpan]}>
                    <Text>{r.span}</Text>
                    {r.spanEnd ? <Text style={s.spanEnd}>{r.spanEnd}</Text> : null}
                  </View>
                  <Text style={[s.td, s.cVessel]} {...noHyphen}>{r.vessel}</Text>
                  <Text style={[s.td, s.cJob]} {...noHyphen}>{r.job}</Text>
                  <Text style={[s.td, s.cClient]} {...noHyphen}>{r.client}</Text>
                  <Text style={[s.td, s.cReg]}>{r.reg}</Text>
                  <Text style={[s.td, s.cOt]}>{r.ot}</Text>
                  <Text style={[s.td, s.cKm]}>{r.km}</Text>
                  <Text style={[s.td, s.cFlag]} {...noHyphen}>{r.flag}</Text>
                </View>
              ))}

              <View style={s.subRow} wrap={false}>
                <Text style={[s.tdTot, s.cDate]}>SUBTOTAL</Text>
                <Text style={[s.tdTot, s.cSpan]} />
                <Text style={[s.tdTot, s.cVessel]} />
                <Text style={[s.tdTot, s.cJob]} />
                <Text style={[s.tdTot, s.cClient]} />
                <Text style={[s.tdTot, s.cReg]}>{sv.totalReg}</Text>
                <Text style={[s.tdTot, s.cOt]}>{sv.totalOt}</Text>
                <Text style={[s.tdTot, s.cKm]}>{sv.totalKm}</Text>
                <Text style={[s.tdTot, s.cFlag]} />
              </View>

              {withPay && sv.payLabel ? (
                <View style={s.subRow} wrap={false}>
                  <Text style={[s.tdTot, s.cDate]}>PAY</Text>
                  <Text style={[s.tdTot, s.cSpan]} />
                  <Text style={[s.tdTot, s.cVessel]} />
                  <Text style={[s.tdTot, s.cJob]} />
                  <Text style={[s.tdTot, s.cClient]} {...noHyphen}>{sv.payLabel}</Text>
                  <Text style={[s.tdTot, s.cReg]} />
                  <Text style={[s.tdTot, s.cOt]} />
                  <Text style={[s.tdTot, s.cKm]} />
                  <Text style={[s.tdTot, s.cFlag]} />
                </View>
              ) : null}
            </View>
          </View>
        ))}

        <View style={s.footer} fixed>
          <Text style={s.footerConf}>
            {COMPANY.confidential} · {COMPANY.name}{withPay ? ' · PAY RUN — ADMIN ONLY' : ''}
          </Text>
        </View>
        <Text style={s.footerPageNo} fixed render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </Page>
    </Document>
  )
}
