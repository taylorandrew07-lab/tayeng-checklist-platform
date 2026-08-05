import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { InvoicePDF } from './InvoicePDF'

// Renders the invoice with an hourly line (qty ≠ 1, multi-line description) and a
// contact name, to guard the qty × unit-price breakdown + MultiLine description +
// "Attention:" fallback all render without throwing.
describe('InvoicePDF render', () => {
  it('renders an hourly, multi-line invoice', async () => {
    const invoice: any = {
      id: 'i1', invoice_number: '26-06-001', currency: 'USD', issue_date: '2026-06-26',
      total: 7150, subtotal: 7150, tax_total: 0, attention: null, reference: 'PO 123',
      description: 'Survey attendance.', bank_details: 'Bank of X\nAcct 123',
    }
    const lines: any[] = [
      // job-linked → prints "Report No." under the description
      { id: 'l1', description: 'M.V. Scout — OVID Survey\n23 Jun 2026 · 06:00–17:00 · 11 hrs', qty: 11, unit_price: 650, amount: 7150, job: { report_number: '220' } },
      // manual/expense line → no job, no report number
      { id: 'l2', description: 'Launch hire', qty: 1, unit_price: 300, amount: 300, job: null },
    ]
    const el = React.createElement(InvoicePDF as any, {
      invoice, lines, taxes: [{ id: 't1', name: 'VAT', rate: 12.5, amount: 893.75 }],
      client: { name: 'ExxonMobil', contact_name: 'Jane Roe', address: 'Pointe-à-Pierre', contact_phone: '868-000-0000' },
      reportNumber: 'TE-26-001',
    })
    const buf = await renderToBuffer(el as any)
    expect(buf.length).toBeGreaterThan(1000)
  }, 25000)

  // The table box is drawn per row (not on the container) so a page break still
  // closes the bottom of one page and opens the top of the next. This guards the
  // multi-page path renders at all — the geometry itself is eyeballed on the PDF.
  it('renders a line set long enough to break across pages', async () => {
    const invoice: any = {
      // due_date set → the "Payment Due" line renders; the case above leaves it unset.
      id: 'i2', invoice_number: '26-07-203', currency: 'TTD', issue_date: '2026-07-10', due_date: '2026-07-31',
      total: 105000, subtotal: 105000, tax_total: 0, attention: null, reference: null,
      description: 'To:  Attending on board the following vessels as they lay afloat at Petrotrin Berth 2, Petrotrin Berth 3, CMF Dock, Chag Terms, NEC Dock in order to carry out sampling and quantify the amount of fuel loaded on the vessels.',
      bank_details: null,
    }
    const lines: any[] = Array.from({ length: 30 }, (_, i) => ({
      id: `l${i}`, description: `M.V. Delta Titan ${i + 1} — Fuel Loadout\n10 Jul 2026`,
      qty: 1, unit_price: 3500, amount: 3500, job: { report_number: String(200 + i) },
    }))
    const el = React.createElement(InvoicePDF as any, {
      invoice, lines, taxes: [], client: { name: 'NGC', address: null, contact_phone: null }, reportNumber: null,
    })
    const buf = await renderToBuffer(el as any)
    expect(buf.length).toBeGreaterThan(1000)
    // More than one /Type /Page object → the invoice really did paginate.
    expect((buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBeGreaterThan(1)
  }, 25000)
})
