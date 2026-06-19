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

/** One report photo, already compressed, for the .docx appendix. */
export interface DocxPhoto { dataUrl: string; width: number; height: number; caption: string }

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(',')[1] ?? ''
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** Fit an image into the cell box (max ~248×186 pt) preserving aspect ratio. */
function fit(w: number, h: number): { width: number; height: number } {
  const scale = Math.min(1, 248 / w, 186 / h)
  return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

function photoCell(p: DocxPhoto): TableCell {
  const dim = fit(p.width, p.height)
  return new TableCell({
    borders: cellBorders,
    width: { size: 50, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'jpg', data: dataUrlToBytes(p.dataUrl), transformation: dim })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: p.caption, size: 15, color: '334155' })] }),
    ],
  })
}

/** A 2-column table laying out the photo appendix. */
function photoTable(photos: DocxPhoto[]): Table {
  const rows: TableRow[] = []
  for (let i = 0; i < photos.length; i += 2) {
    const cells = [photoCell(photos[i])]
    if (photos[i + 1]) cells.push(photoCell(photos[i + 1]))
    else cells.push(new TableCell({ borders: cellBorders, width: { size: 50, type: WidthType.PERCENTAGE }, children: [new Paragraph({ text: '' })] }))
    rows.push(new TableRow({ children: cells }))
  }
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })
}

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

export async function buildDriDocxBlob(blocks: Block[], reportTitle: string, logo?: { data: Uint8Array; width: number; height: number }, photos?: DocxPhoto[]): Promise<Blob> {
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
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, alignment: AlignmentType.CENTER, spacing: { before: 200, after: 80 }, children: [new TextRun({ text: b.text, bold: true, color: BRAND })] }))
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

  if (photos && photos.length) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 }, children: [new TextRun({ text: 'PHOTOGRAPHS', bold: true, color: BRAND })] }))
    children.push(photoTable(photos))
  }

  const doc = new Document({ creator: COMPANY.name, title: reportTitle, sections: [{ children }] })
  return Packer.toBlob(doc)
}
