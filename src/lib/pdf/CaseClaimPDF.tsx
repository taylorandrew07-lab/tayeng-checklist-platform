import React from 'react'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { COMPANY } from '@/lib/company'

// A P&I case claim: the time and costs being billed for a period, in one currency.
//
// This is NOT an invoice and must never read like one. No invoice number, no payment
// terms, no bank details — the actual invoice is raised outside this app, and a document
// that looked like one would end up being treated as one. It is a schedule of what is
// being claimed, to attach to that invoice or to send on its own.
//
// EVERY PROP IS A PREFORMATTED STRING except `amount`, which is a number only so the
// column can be right-aligned and the total checked. This file does no currency
// arithmetic and no rounding: the amounts come from case_attendances.charge_amount,
// which is GENERATED in the database, so the page cannot disagree with the case.
//
// ONE CURRENCY PER DOCUMENT, by construction — a claim holds exactly one, so there is no
// mixed total to print and no conversion to explain.

const BRAND = '#1d4ed8'
const INK = '#1e293b'
const MUTE = '#64748b'
const LINE = '#cbd5e1'

const KEEP_WHOLE = (word: string): string[] => [word]
const noHyphen = { hyphenationCallback: KEEP_WHOLE }

const s = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 46, paddingHorizontal: 34, fontSize: 9, color: INK, fontFamily: 'Helvetica' },

  brand: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: BRAND },
  company: { fontSize: 8, color: MUTE, marginTop: 2 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
          borderBottomWidth: 1, borderBottomColor: LINE, paddingBottom: 8, marginBottom: 10 },
  docTitle: { fontSize: 12, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  docMeta: { fontSize: 8, color: MUTE, textAlign: 'right', marginTop: 2 },

  facts: { marginBottom: 10 },
  factRow: { flexDirection: 'row', marginBottom: 1.5 },
  factKey: { width: 78, color: MUTE, fontSize: 8 },
  factVal: { flex: 1, fontSize: 9 },

  // 523pt usable on A4 portrait. Amount is widest-but-last so the eye lands on it.
  th: { flexDirection: 'row', backgroundColor: '#f1f5f9', borderTopWidth: 1, borderBottomWidth: 1,
        borderColor: LINE, paddingVertical: 4 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 4 },
  cDate: { width: 58, paddingHorizontal: 3 },
  cWho: { width: 92, paddingHorizontal: 3 },
  org: { fontSize: 7, color: MUTE },
  cDetail: { flex: 1, paddingHorizontal: 3 },
  cBasis: { width: 58, paddingHorizontal: 3 },
  cQty: { width: 40, paddingHorizontal: 3, textAlign: 'right' },
  cRate: { width: 52, paddingHorizontal: 3, textAlign: 'right' },
  cAmt: { width: 70, paddingHorizontal: 3, textAlign: 'right' },
  thText: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: MUTE },

  totalRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: INK, paddingTop: 6, marginTop: 2 },
  totalLabel: { flex: 1, textAlign: 'right', paddingRight: 8, fontFamily: 'Helvetica-Bold' },
  totalVal: { width: 70, textAlign: 'right', paddingHorizontal: 3, fontFamily: 'Helvetica-Bold', fontSize: 10 },

  summary: { marginTop: 12, fontSize: 8, color: MUTE },
  foot: { position: 'absolute', bottom: 22, left: 34, right: 34, fontSize: 7, color: MUTE,
          borderTopWidth: 0.5, borderTopColor: LINE, paddingTop: 5,
          flexDirection: 'row', justifyContent: 'space-between' },
})

export interface ClaimPdfLine {
  date: string
  who: string
  /** The firm behind the name. Set under it in small type, so the Who column stays
   *  readable at 92pt while still saying who the club is paying for. */
  org: string
  detail: string
  basis: string
  qty: string
  rate: string
  amount: number
}

export interface CaseClaimPdfProps {
  caseTitle: string
  caseType?: string | null
  ourVessel?: string | null
  otherParty?: string | null
  caseRef?: string | null
  principal?: string | null
  currency: string
  cutoff: string
  claimNo?: number | null
  timeLabel: string
  lines: ClaimPdfLine[]
  total: number
}

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function Fact({ k, v }: { k: string; v?: string | null }) {
  if (!v) return null
  return (
    <View style={s.factRow}>
      <Text style={s.factKey}>{k}</Text>
      <Text style={s.factVal} {...noHyphen}>{v}</Text>
    </View>
  )
}

export function CaseClaimPDF(p: CaseClaimPdfProps) {
  return (
    <Document title={`${p.caseTitle} — claim`}>
      <Page size="A4" style={s.page}>
        <View style={s.head}>
          <View>
            <Text style={s.brand}>{COMPANY.name}</Text>
            <Text style={s.company}>{COMPANY.address}</Text>
          </View>
          <View>
            <Text style={s.docTitle}>P&amp;I CASE CLAIM</Text>
            <Text style={s.docMeta}>
              {p.claimNo ? `Claim ${p.claimNo} · ` : ''}Up to {p.cutoff}
            </Text>
            <Text style={s.docMeta}>All amounts in {p.currency}</Text>
          </View>
        </View>

        <View style={s.facts}>
          <Fact k="Case" v={p.caseTitle} />
          <Fact k="Type" v={p.caseType} />
          <Fact k="Our vessel" v={p.ourVessel} />
          <Fact k="Other party" v={p.otherParty} />
          <Fact k="Reference" v={p.caseRef} />
          <Fact k="Principal" v={p.principal} />
        </View>

        <View style={s.th}>
          <Text style={[s.cDate, s.thText]}>Date</Text>
          <Text style={[s.cWho, s.thText]}>Who</Text>
          <Text style={[s.cDetail, s.thText]}>Detail</Text>
          <Text style={[s.cBasis, s.thText]}>Basis</Text>
          <Text style={[s.cQty, s.thText]}>Qty</Text>
          <Text style={[s.cRate, s.thText]}>Rate</Text>
          <Text style={[s.cAmt, s.thText]}>Amount</Text>
        </View>

        {p.lines.map((l, i) => (
          <View key={i} style={s.tr} wrap={false}>
            <Text style={s.cDate}>{l.date}</Text>
            <View style={s.cWho}>
              <Text {...noHyphen}>{l.who}</Text>
              {l.org ? <Text style={s.org} {...noHyphen}>{l.org}</Text> : null}
            </View>
            <Text style={s.cDetail} {...noHyphen}>{l.detail}</Text>
            <Text style={s.cBasis}>{l.basis}</Text>
            <Text style={s.cQty}>{l.qty}</Text>
            <Text style={s.cRate}>{l.rate}</Text>
            <Text style={s.cAmt}>{money(l.amount)}</Text>
          </View>
        ))}

        <View style={s.totalRow}>
          <Text style={s.totalLabel}>Total {p.currency}</Text>
          <Text style={s.totalVal}>{money(p.total)}</Text>
        </View>

        <Text style={s.summary}>
          {p.lines.length} item{p.lines.length === 1 ? '' : 's'} · {p.timeLabel} of attendance
        </Text>

        <View style={s.foot} fixed>
          <Text>{COMPANY.name} — Private and Confidential</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
