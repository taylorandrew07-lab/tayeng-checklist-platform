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
  //
  // The box is drawn PER ROW, not on the table container. A single container border
  // is only painted around the whole block, so on a two-page invoice the bottom of
  // page 1 and the top of page 2 came out open-ended. Every row carrying its own
  // left/right/bottom edge means whichever row the page break lands on still closes
  // the box, and the header repeats (fixed) to put a lid on each new page.
  table: {},
  thead: {
    flexDirection: 'row', backgroundColor: '#f1f5f9',
    borderTopWidth: 1, borderTopColor: INK, borderBottomWidth: 1, borderBottomColor: INK,
    borderLeftWidth: 1, borderLeftColor: INK, borderRightWidth: 1, borderRightColor: INK,
  },
  thDesc: { flex: 1, padding: '5 8', fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  thAmt: { width: 130, padding: '5 8', fontFamily: 'Helvetica-Bold', textAlign: 'center', borderLeftWidth: 1, borderLeftColor: INK },

  bodyRow: {
    flexDirection: 'row', minHeight: 18,
    borderLeftWidth: 1, borderLeftColor: INK, borderRightWidth: 1, borderRightColor: INK,
    borderBottomWidth: 1, borderBottomColor: INK,
  },
  tdDesc: { flex: 1, padding: '4 8' },
  tdAmt: { width: 130, padding: '4 8', textAlign: 'right', borderLeftWidth: 1, borderLeftColor: INK },

  // The narrative is the description cell of its own row, so the column divider
  // runs unbroken from the header down — the row around it carries the box.
  narrative: { flex: 1, padding: '8 8 6 8' },
  refLine: { fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  bodyText: { color: INK },

  lineLabel: { fontFamily: 'Helvetica-Bold' },
  qtyNote: { fontSize: 9, color: MUTE, marginTop: 1 },
  // The name row is three columns — vessel, survey type, report number — at FIXED
  // widths, so they line up as columns down the page instead of each row wrapping
  // to wherever its own text happens to end. Everything rides on this one line
  // rather than stacking; a line each cost a whole page on a 25-vessel invoice.
  headRow: { flexDirection: 'row', alignItems: 'flex-start' },
  // Fixed widths (the cell is 378pt wide), sized so the longest real values clear on
  // one line: "M.V. Delta Vanguard", "Cargo Survey (Discharging)" and
  // "Report No. 26-07-200". Column position alone separates them — no punctuation
  // between, so nothing has to be kerned into looking evenly spaced.
  headVessel: { width: 118, fontFamily: 'Helvetica-Bold' },
  headType: { flex: 1, fontFamily: 'Helvetica-Bold' },
  // Not bold, so it reads as a reference against the bold name it sits beside.
  headReport: { width: 96, fontFamily: 'Helvetica', fontSize: 9, color: MUTE },
  reportInline: { fontFamily: 'Helvetica', fontSize: 9, color: MUTE },
  // No top border: the last row above already draws its own bottom edge, and two
  // adjacent borders render as a doubled rule rather than collapsing into one.
  totalRow: {
    flexDirection: 'row',
    borderLeftWidth: 1, borderLeftColor: INK, borderRightWidth: 1, borderRightColor: INK,
    borderBottomWidth: 1, borderBottomColor: INK,
  },
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

/** A line plus the report number of the job it bills (embedded in renderInvoice).
 *  Absent on manual/expense lines, which carry no job. */
export type InvoiceLineWithJob = InvoiceLineItem & { job?: { report_number: string | null } | null }

export interface InvoicePDFProps {
  invoice: Invoice
  lines: InvoiceLineWithJob[]
  taxes: InvoiceTax[]
  client: { name: string | null; contact_name?: string | null; address: string | null; contact_phone: string | null } | null
  reportNumber: string | null
  logoSrc?: string
}

// Trim a quantity for display: 11 → "11", 10.5 → "10.5" (no forced decimals).
const qtyStr = (n: number) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })

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
        {/* Payment terms only appear when a due date was actually chosen — an invoice
            with no agreed date must not imply one. */}
        {invoice.due_date ? (
          <View style={s.metaRow}>
            <Text> </Text>
            <Text><Text style={s.metaStrong}>Payment Due:</Text> {longDate(invoice.due_date)}</Text>
          </View>
        ) : null}
        {reportNumber ? <Text><Text style={s.metaStrong}>Report Ref:</Text> {reportNumber}</Text> : null}

        {/* Bill to */}
        <View style={s.billBlock}>
          <View style={s.billRow}><Text style={s.billLabel}>To:</Text><Text style={s.billVal}>{client?.name ?? '—'}</Text></View>
          {client?.address ? (
            <View style={s.billRow}><Text style={s.billLabel}>Address:</Text><View style={s.billVal}><MultiLine text={client.address} /></View></View>
          ) : null}
          {(invoice.attention || client?.contact_name) ? <View style={s.billRow}><Text style={s.billLabel}>Attention:</Text><Text style={s.billVal}>{invoice.attention || client?.contact_name}</Text></View> : null}
          {client?.contact_phone ? <View style={s.billRow}><Text style={s.billLabel}>Tel#</Text><Text style={s.billVal}>{client.contact_phone}</Text></View> : null}
          {invoice.reference ? <View style={s.billRow}><Text style={s.billLabel}>Your Ref:</Text><Text style={s.billVal}>{invoice.reference}</Text></View> : null}
        </View>

        {/* Description / amount table */}
        <View style={s.table}>
          {/* fixed → the column headings repeat at the top of every page, which is
              also what draws the table's top edge on a continuation page. */}
          <View style={s.thead} fixed>
            <Text style={s.thDesc}>DESCRIPTION</Text>
            <Text style={s.thAmt}>AMOUNT</Text>
          </View>

          {invoice.description ? (
            <View style={s.bodyRow} wrap={false}>
              <View style={s.narrative}><MultiLine text={invoice.description} style={s.bodyText} /></View>
              <Text style={s.tdAmt} />
            </View>
          ) : null}

          {lines.map(li => {
            // The builder seeds the first line as "M.V. Vessel — Job Type (Stage)".
            // Split it on that em dash so the vessel, the type and the report number
            // become three aligned columns on one line. A line the user has retyped
            // (or a manual/expense line) has no dash and stays full-width, or a long
            // description would be squeezed into the vessel column and wrap.
            const descLines = li.description.split('\n')
            const head = descLines[0] ?? ''
            const dash = head.indexOf(' — ')
            const reportRef = li.job?.report_number ? `Report No. ${li.job.report_number}` : ''
            return (
              <View key={li.id} style={s.bodyRow} wrap={false}>
                <View style={s.tdDesc}>
                  {dash >= 0 ? (
                    <View style={s.headRow}>
                      <Text style={s.headVessel}>{head.slice(0, dash)}</Text>
                      <Text style={s.headType}>{head.slice(dash + 3)}</Text>
                      <Text style={s.headReport}>{reportRef}</Text>
                    </View>
                  ) : (
                    <Text style={s.lineLabel}>
                      {head || ' '}
                      {reportRef ? <Text style={s.reportInline}>  ·  {reportRef}</Text> : null}
                    </Text>
                  )}
                  {descLines.slice(1).map((ln, i) => <Text key={i} style={s.bodyText}>{ln || ' '}</Text>)}
                  {/* Show the live qty × unit-price breakdown (e.g. an hourly job:
                      "11 × US$ 650.00") whenever the quantity isn't a plain 1, so an
                      hourly/multi-unit total is spelled out rather than just a lump sum. */}
                  {Number(li.qty) !== 1 ? <Text style={s.qtyNote}>{qtyStr(Number(li.qty))} × {fmt(Number(li.unit_price), cur)}</Text> : null}
                </View>
                <Text style={s.tdAmt}>{fmt(Number(li.amount), cur)}</Text>
              </View>
            )
          })}

          {taxes.map(tx => (
            <View key={tx.id} style={s.bodyRow} wrap={false}>
              <View style={s.tdDesc}><Text>{tx.name}{tx.rate ? ` (${Number(tx.rate)}%)` : ''}</Text></View>
              <Text style={s.tdAmt}>{fmt(Number(tx.amount), cur)}</Text>
            </View>
          ))}

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
          <Text style={s.footerPage}>{COMPANY.confidential}</Text>
          <Text style={s.footerPage} render={({ pageNumber, totalPages }) => totalPages > 1 ? `Page ${pageNumber} of ${totalPages}` : ''} />
        </View>
      </Page>
    </Document>
  )
}
