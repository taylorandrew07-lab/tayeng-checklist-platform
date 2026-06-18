import React from 'react'
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'
import { format, parseISO } from 'date-fns'
import { COMPANY } from '@/lib/company'
import type { Invoice, InvoiceLineItem, InvoiceTax } from '@/lib/types/database'

const BRAND = '#1d4ed8'
const INK = '#1e293b'
const MUTE = '#64748b'
const LINE = '#cbd5e1'

const CUR: Record<string, string> = { USD: 'US$', TTD: 'TT$', EUR: '€', GBP: '£' }
const fmt = (n: number, c: string) => `${CUR[c] ?? c} ${(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const longDate = (iso: string | null) => { try { return iso ? format(parseISO(iso), 'do MMMM yyyy') : '' } catch { return iso ?? '' } }

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 10, color: INK, paddingTop: 34, paddingBottom: 56, paddingHorizontal: 44, lineHeight: 1.4 },

  // Letterhead
  logo: { width: 188, alignSelf: 'center', marginBottom: 4 },
  wordmark: { fontSize: 19, fontFamily: 'Helvetica-Bold', color: BRAND, textAlign: 'center', letterSpacing: 0.3 },
  tagline: { fontSize: 7.5, color: MUTE, textAlign: 'center', letterSpacing: 1.4, marginTop: 2, marginBottom: 4 },
  headLine: { fontSize: 8, color: MUTE, textAlign: 'center' },
  rule: { borderBottomWidth: 1.5, borderBottomColor: BRAND, marginTop: 8, marginBottom: 12 },
  title: { fontSize: 14, fontFamily: 'Helvetica-Bold', letterSpacing: 1, textAlign: 'center', marginBottom: 12, color: INK },

  vat: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', marginBottom: 8 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  metaStrong: { fontFamily: 'Helvetica-Bold' },

  // Bill-to
  billBlock: { marginTop: 10, marginBottom: 12 },
  billRow: { flexDirection: 'row', marginBottom: 1.5 },
  billLabel: { width: 64, fontFamily: 'Helvetica-Bold', color: INK },
  billVal: { flex: 1 },

  // Table
  table: { borderWidth: 1, borderColor: INK },
  thead: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: INK, backgroundColor: '#f1f5f9' },
  thDesc: { flex: 1, padding: '5 8', fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  thAmt: { width: 130, padding: '5 8', fontFamily: 'Helvetica-Bold', textAlign: 'center', borderLeftWidth: 1, borderLeftColor: INK },

  bodyRow: { flexDirection: 'row', minHeight: 18 },
  tdDesc: { flex: 1, padding: '4 8' },
  tdAmt: { width: 130, padding: '4 8', textAlign: 'right', borderLeftWidth: 1, borderLeftColor: INK },

  narrative: { padding: '8 8 4 8' },
  refLine: { fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  bodyText: { color: INK },

  lineLabel: { fontFamily: 'Helvetica-Bold' },
  totalRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: INK },
  tdTotalLabel: { flex: 1, padding: '5 8', textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  tdTotalAmt: { width: 130, padding: '5 8', textAlign: 'right', fontFamily: 'Helvetica-Bold', borderLeftWidth: 1, borderLeftColor: INK },

  approved: { marginTop: 22, flexDirection: 'row', alignItems: 'flex-end' },
  approvedLabel: { fontFamily: 'Helvetica-Bold', marginRight: 8 },
  approvedLine: { width: 200, borderBottomWidth: 1, borderBottomColor: INK, height: 1 },

  bank: { marginTop: 18 },
  bankHead: { fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  bankText: { fontSize: 9, color: INK },

  footer: { position: 'absolute', bottom: 26, left: 44, right: 44 },
  footerTerms: { textAlign: 'center', fontSize: 9, fontFamily: 'Helvetica-Bold', color: INK },
  footerPage: { textAlign: 'center', fontSize: 7.5, color: MUTE, marginTop: 3 },
})

// Render a multi-line block, preserving the author's line breaks.
function MultiLine({ text, style, firstBold }: { text: string; style?: any; firstBold?: boolean }) {
  const lines = text.split('\n')
  return (
    <>
      {lines.map((ln, i) => (
        <Text key={i} style={[style ?? {}, firstBold && i === 0 ? { fontFamily: 'Helvetica-Bold' } : {}]}>{ln || ' '}</Text>
      ))}
    </>
  )
}

export interface InvoicePDFProps {
  invoice: Invoice
  lines: InvoiceLineItem[]
  taxes: InvoiceTax[]
  client: { name: string | null; address: string | null; contact_phone: string | null } | null
  reportNumber: string | null
  logoSrc?: string
}

export function InvoicePDF({ invoice, lines, taxes, client, reportNumber, logoSrc }: InvoicePDFProps) {
  const cur = invoice.currency
  return (
    <Document title={`Invoice ${invoice.invoice_number ?? ''}`.trim()} author={COMPANY.name} subject="Tax Invoice">
      <Page size="LETTER" style={s.page}>
        {/* Letterhead */}
        {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image renders to PDF, no HTML alt */}
        {logoSrc ? <Image src={logoSrc} style={s.logo} /> : (
          <>
            <Text style={s.wordmark}>{COMPANY.name}</Text>
            <Text style={s.tagline}>{COMPANY.tagline}</Text>
          </>
        )}
        <Text style={s.headLine}>{COMPANY.address}</Text>
        <Text style={s.headLine}>T {COMPANY.phone}, {COMPANY.phoneAlt}   F {COMPANY.fax}   E {COMPANY.email}</Text>
        <View style={s.rule} />

        <Text style={s.title}>TAX INVOICE</Text>

        <Text style={s.vat}>VAT Reg&apos;d No. {COMPANY.vatRegNo}</Text>
        <View style={s.metaRow}>
          <Text><Text style={s.metaStrong}>Invoice No.</Text> {invoice.invoice_number ?? '—'}</Text>
          <Text><Text style={s.metaStrong}>Date:</Text> {longDate(invoice.issue_date)}</Text>
        </View>
        {reportNumber ? <Text><Text style={s.metaStrong}>Report Ref:</Text> {reportNumber}</Text> : null}

        {/* Bill to */}
        <View style={s.billBlock}>
          <View style={s.billRow}><Text style={s.billLabel}>To:</Text><Text style={s.billVal}>{client?.name ?? '—'}</Text></View>
          {client?.address ? (
            <View style={s.billRow}><Text style={s.billLabel}>Address:</Text><View style={s.billVal}><MultiLine text={client.address} /></View></View>
          ) : null}
          {invoice.attention ? <View style={s.billRow}><Text style={s.billLabel}> </Text><Text style={s.billVal}>{invoice.attention}</Text></View> : null}
          {client?.contact_phone ? <View style={s.billRow}><Text style={s.billLabel}>Tel#</Text><Text style={s.billVal}>{client.contact_phone}</Text></View> : null}
          {invoice.reference ? <View style={s.billRow}><Text style={s.billLabel}>Your Ref:</Text><Text style={s.billVal}>{invoice.reference}</Text></View> : null}
        </View>

        {/* Description / amount table */}
        <View style={s.table}>
          <View style={s.thead}>
            <Text style={s.thDesc}>DESCRIPTION</Text>
            <Text style={s.thAmt}>AMOUNT</Text>
          </View>

          {invoice.description ? (
            <View style={s.narrative}><MultiLine text={invoice.description} style={s.bodyText} /></View>
          ) : null}

          {lines.map(li => (
            <View key={li.id} style={s.bodyRow} wrap={false}>
              <View style={s.tdDesc}><Text style={s.lineLabel}>{li.description}</Text></View>
              <Text style={s.tdAmt}>{fmt(Number(li.amount), cur)}</Text>
            </View>
          ))}

          {taxes.map(tx => (
            <View key={tx.id} style={s.bodyRow} wrap={false}>
              <View style={s.tdDesc}><Text>{tx.name}{tx.rate ? ` (${Number(tx.rate)}%)` : ''}</Text></View>
              <Text style={s.tdAmt}>{fmt(Number(tx.amount), cur)}</Text>
            </View>
          ))}

          {/* a little breathing room before the total */}
          <View style={[s.bodyRow, { minHeight: 10 }]}><View style={s.tdDesc} /><Text style={s.tdAmt} /></View>

          <View style={s.totalRow}>
            <Text style={s.tdTotalLabel}>TOTAL</Text>
            <Text style={s.tdTotalAmt}>{fmt(Number(invoice.total), cur)}</Text>
          </View>
        </View>

        {/* Approved by */}
        <View style={s.approved}>
          <Text style={s.approvedLabel}>APPROVED BY :</Text>
          <View style={s.approvedLine} />
        </View>

        {/* Bank details (foreign invoices) */}
        {invoice.bank_details ? (
          <View style={s.bank}>
            <Text style={s.bankHead}>BANK DETAILS:-</Text>
            <MultiLine text={invoice.bank_details} style={s.bankText} />
          </View>
        ) : null}

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerTerms}>{COMPANY.invoiceTerms}</Text>
          <Text style={s.footerPage} render={({ pageNumber, totalPages }) => totalPages > 1 ? `Page ${pageNumber} of ${totalPages}` : ''} />
        </View>
      </Page>
    </Document>
  )
}
