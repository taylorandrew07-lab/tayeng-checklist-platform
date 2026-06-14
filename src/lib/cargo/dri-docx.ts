// .docx export of the DRI report — consumes the SAME Block[] the PDF uses, so
// both outputs always match the canonical section order and legacy layout.

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ImageRun,
} from 'docx'
import { COMPANY } from '@/lib/company'
import type { Block } from '@/lib/cargo/dri-report'

const BRAND = '1d4ed8'
const LINE = 'cbd5e1'
const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: LINE }
const cellBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder }

function tableBlock(headers: string[], rows: string[][]): Table {
  const headRow = new TableRow({
    tableHeader: true,
    children: headers.map(h => new TableCell({
      borders: cellBorders, shading: { fill: 'f1f5f9' },
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 16 })] })],
    })),
  })
  const bodyRows = rows.map(r => new TableRow({
    children: r.map(c => new TableCell({ borders: cellBorders, children: [new Paragraph({ children: [new TextRun({ text: c, size: 16 })] })] })),
  }))
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headRow, ...bodyRows] })
}

export async function buildDriDocxBlob(blocks: Block[], reportTitle: string, logo?: { data: Uint8Array; width: number; height: number }): Promise<Blob> {
  const children: (Paragraph | Table)[] = [
    logo
      ? new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: logo.data, transformation: { width: logo.width, height: logo.height } })] })
      : new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: COMPANY.name, bold: true, size: 26, color: BRAND })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${COMPANY.address}   ·   ${COMPANY.email}`, size: 15, color: '64748b' })] }),
    new Paragraph({ text: '' }),
  ]

  for (const b of blocks) {
    switch (b.kind) {
      case 'h1':
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: b.text, bold: true, size: 26 })] }))
        break
      case 'h2':
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 }, children: [new TextRun({ text: b.text, bold: true, color: BRAND })] }))
        break
      case 'p':
        children.push(new Paragraph({ children: [new TextRun({ text: b.text, bold: b.bold, size: 18 })] }))
        break
      case 'table':
        children.push(tableBlock(b.headers, b.rows))
        children.push(new Paragraph({ text: '' }))
        break
    }
  }

  const doc = new Document({ creator: COMPANY.name, title: reportTitle, sections: [{ children }] })
  return Packer.toBlob(doc)
}
