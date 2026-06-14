import React from 'react'
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'
import { COMPANY } from '@/lib/company'
import type { Block } from '@/lib/cargo/dri-report'

const BRAND = '#1d4ed8'
const INK = '#1e293b'
const MUTE = '#64748b'
const LINE = '#cbd5e1'

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, color: INK, paddingTop: 34, paddingBottom: 44, paddingHorizontal: 44, lineHeight: 1.4 },
  logo: { width: 188, alignSelf: 'center', marginBottom: 5 },
  brand: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: BRAND, textAlign: 'center' },
  headLine: { fontSize: 7.5, color: MUTE, textAlign: 'center' },
  rule: { borderBottomWidth: 1.5, borderBottomColor: BRAND, marginTop: 6, marginBottom: 12 },
  h1: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: INK, textAlign: 'center', marginBottom: 4 },
  h2: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: BRAND, marginTop: 12, marginBottom: 4, borderBottomWidth: 0.5, borderBottomColor: LINE, paddingBottom: 2 },
  p: { fontSize: 9, marginBottom: 3 },
  pBold: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginBottom: 3 },
  table: { borderWidth: 0.5, borderColor: LINE, marginTop: 3, marginBottom: 6 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: LINE },
  th: { flex: 1, padding: '3 5', fontFamily: 'Helvetica-Bold', fontSize: 8, backgroundColor: '#f1f5f9' },
  td: { flex: 1, padding: '3 5', fontSize: 8 },
  footer: { position: 'absolute', bottom: 22, left: 44, right: 44, flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 7, color: MUTE },
})

function TableBlock({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <View style={s.table}>
      <View style={s.tr}>{headers.map((h, i) => <Text key={i} style={s.th}>{h}</Text>)}</View>
      {rows.map((r, ri) => (
        <View key={ri} style={s.tr} wrap={false}>{r.map((c, ci) => <Text key={ci} style={s.td}>{c}</Text>)}</View>
      ))}
    </View>
  )
}

export function DriReportDocument({ blocks, title, logoDataUrl }: { blocks: Block[]; title: string; logoDataUrl?: string | null }) {
  return (
    <Document title={title} author={COMPANY.name} subject="DRI Production Report">
      <Page size="LETTER" style={s.page}>
        {logoDataUrl ? <Image src={logoDataUrl} style={s.logo} /> : <Text style={s.brand}>{COMPANY.name}</Text>}
        <Text style={s.headLine}>{COMPANY.address}   ·   T {COMPANY.phone}   ·   {COMPANY.email}</Text>
        <View style={s.rule} />
        {blocks.map((b, i) => {
          switch (b.kind) {
            case 'h1': return <Text key={i} style={s.h1}>{b.text}</Text>
            case 'h2': return <Text key={i} style={s.h2}>{b.text}</Text>
            case 'p': return <Text key={i} style={b.bold ? s.pBold : s.p}>{b.text}</Text>
            case 'table': return <TableBlock key={i} headers={b.headers} rows={b.rows} />
          }
        })}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>{COMPANY.name}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
