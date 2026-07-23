import React from 'react'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { COMPANY } from '@/lib/company'

// A clean, branded "work statement" a surveyor can export for a chosen period — the
// jobs they were on, with regular hours, overtime and distance tallied and totalled
// by vessel. It is a record of work LOGGED, not a pay statement (rates/pay are never
// shown to surveyors), and says so in the footer.

const BRAND = '#1d4ed8'
const INK = '#1e293b'
const MUTE = '#64748b'
const LINE = '#cbd5e1'

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 10, color: INK, paddingTop: 34, paddingBottom: 52, paddingHorizontal: 44, lineHeight: 1.4 },
  wordmark: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: BRAND, textAlign: 'center', letterSpacing: 0.3 },
  tagline: { fontSize: 7.5, color: MUTE, textAlign: 'center', letterSpacing: 1.4, marginTop: 2 },
  headLine: { fontSize: 8, color: MUTE, textAlign: 'center', marginTop: 2 },
  rule: { borderBottomWidth: 1.5, borderBottomColor: BRAND, marginTop: 8, marginBottom: 12 },
  title: { fontSize: 13, fontFamily: 'Helvetica-Bold', letterSpacing: 1, textAlign: 'center', marginBottom: 10 },

  meta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  metaCol: { flexDirection: 'column' },
  metaLabel: { fontSize: 7.5, color: MUTE, letterSpacing: 0.6 },
  metaVal: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: INK },

  // Totals band
  totals: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  totalCard: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: '6 8' },
  totalLabel: { fontSize: 7.5, color: MUTE, letterSpacing: 0.6 },
  totalVal: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: INK, marginTop: 1 },

  table: { borderWidth: 1, borderColor: INK },
  thead: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: INK, backgroundColor: '#f1f5f9' },
  th: { padding: '4 6', fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: LINE, minHeight: 16 },
  td: { padding: '3 6', fontSize: 9 },
  cDate: { width: 62 },
  cVessel: { flex: 1 },
  cClient: { width: 96 },
  cNum: { width: 50, textAlign: 'right' },
  totalRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: INK },
  tdTot: { padding: '4 6', fontFamily: 'Helvetica-Bold', fontSize: 9 },

  note: { fontSize: 8, color: MUTE, marginTop: 10 },
  footer: { position: 'absolute', bottom: 24, left: 44, right: 44 },
  footerText: { textAlign: 'center', fontSize: 7.5, color: MUTE },
})

export interface StatementRow {
  date: string
  vessel: string
  client: string
  reg: string   // preformatted qty, e.g. "8 h" / "1 d" / "—"
  ot: string
  km: string
}

export interface SurveyorStatementProps {
  surveyorName: string
  periodLabel: string
  generatedLabel: string
  rows: StatementRow[]
  totalReg: string
  totalOt: string
  totalKm: string
}

export function SurveyorStatementPDF({ surveyorName, periodLabel, generatedLabel, rows, totalReg, totalOt, totalKm }: SurveyorStatementProps) {
  return (
    <Document title={`Work statement — ${surveyorName} — ${periodLabel}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.wordmark}>{COMPANY.name}</Text>
        <Text style={s.tagline}>{COMPANY.tagline}</Text>
        <Text style={s.headLine}>{COMPANY.address}</Text>
        <View style={s.rule} />

        <Text style={s.title}>SURVEYOR WORK STATEMENT</Text>

        <View style={s.meta}>
          <View style={s.metaCol}><Text style={s.metaLabel}>SURVEYOR</Text><Text style={s.metaVal}>{surveyorName}</Text></View>
          <View style={[s.metaCol, { alignItems: 'center' }]}><Text style={s.metaLabel}>PERIOD</Text><Text style={s.metaVal}>{periodLabel}</Text></View>
          <View style={[s.metaCol, { alignItems: 'flex-end' }]}><Text style={s.metaLabel}>GENERATED</Text><Text style={s.metaVal}>{generatedLabel}</Text></View>
        </View>

        <View style={s.totals}>
          <View style={s.totalCard}><Text style={s.totalLabel}>REGULAR</Text><Text style={s.totalVal}>{totalReg}</Text></View>
          <View style={s.totalCard}><Text style={s.totalLabel}>OVERTIME</Text><Text style={s.totalVal}>{totalOt}</Text></View>
          <View style={s.totalCard}><Text style={s.totalLabel}>DISTANCE</Text><Text style={s.totalVal}>{totalKm}</Text></View>
          <View style={s.totalCard}><Text style={s.totalLabel}>JOBS</Text><Text style={s.totalVal}>{String(rows.length)}</Text></View>
        </View>

        <View style={s.table}>
          <View style={s.thead}>
            <Text style={[s.th, s.cDate]}>Date</Text>
            <Text style={[s.th, s.cVessel]}>Vessel</Text>
            <Text style={[s.th, s.cClient]}>Client</Text>
            <Text style={[s.th, s.cNum]}>Reg</Text>
            <Text style={[s.th, s.cNum]}>OT</Text>
            <Text style={[s.th, s.cNum]}>Km</Text>
          </View>
          {rows.map((r, i) => (
            <View key={i} style={s.row} wrap={false}>
              <Text style={[s.td, s.cDate]}>{r.date}</Text>
              <Text style={[s.td, s.cVessel]}>{r.vessel}</Text>
              <Text style={[s.td, s.cClient]}>{r.client}</Text>
              <Text style={[s.td, s.cNum]}>{r.reg}</Text>
              <Text style={[s.td, s.cNum]}>{r.ot}</Text>
              <Text style={[s.td, s.cNum]}>{r.km}</Text>
            </View>
          ))}
          <View style={s.totalRow}>
            <Text style={[s.tdTot, s.cDate]}>TOTAL</Text>
            <Text style={[s.tdTot, s.cVessel]} />
            <Text style={[s.tdTot, s.cClient]} />
            <Text style={[s.tdTot, s.cNum]}>{totalReg}</Text>
            <Text style={[s.tdTot, s.cNum]}>{totalOt}</Text>
            <Text style={[s.tdTot, s.cNum]}>{totalKm}</Text>
          </View>
        </View>

        <Text style={s.note}>
          This statement is a record of the work you logged for the period above. It is not a pay statement — rates and amounts are not shown.
        </Text>

        <View style={s.footer} fixed>
          <Text style={s.footerText}>{COMPANY.confidential} · {COMPANY.name} · {COMPANY.website}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
