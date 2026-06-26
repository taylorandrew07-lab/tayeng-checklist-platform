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
      { id: 'l1', description: 'M.V. Scout — OVID Survey\n23 Jun 2026 · 06:00–17:00 · 11 hrs', qty: 11, unit_price: 650, amount: 7150 },
      { id: 'l2', description: 'Launch hire', qty: 1, unit_price: 300, amount: 300 },
    ]
    const el = React.createElement(InvoicePDF as any, {
      invoice, lines, taxes: [{ id: 't1', name: 'VAT', rate: 12.5, amount: 893.75 }],
      client: { name: 'ExxonMobil', contact_name: 'Jane Roe', address: 'Pointe-à-Pierre', contact_phone: '868-000-0000' },
      reportNumber: 'TE-26-001',
    })
    const buf = await renderToBuffer(el as any)
    expect(buf.length).toBeGreaterThan(1000)
  }, 25000)
})
