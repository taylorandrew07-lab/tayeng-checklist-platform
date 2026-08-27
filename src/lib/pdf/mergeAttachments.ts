// Appending a job's attached DOCUMENTS to the end of its rendered report.
//
// SERVER ONLY. This module is imported by src/app/api/pdf/[jobId]/route.ts, which is
// already a Node-runtime route (it imports sharp and exifr). Never import it from a
// client component: pdf-lib has no business in a browser bundle, and the CSP traps in
// CLAUDE.md are all about what runs in the page.
//
// WHY IT EXISTS
// An "attach" question takes a document as readily as a photograph — on report 26-08-263
// item 2.11 carries the ship's particulars sheet and item 6.9 the crew list, both PDFs.
// A PDF cannot go through @react-pdf's <Image> (it fails the WHOLE render), so until now
// a non-image attachment printed as one line of grey text, "Attached: <filename>". The
// client therefore received a signed report that CITES a crew list it does not contain.
//
// WHY pdf-lib AND NOT SOMETHING ALREADY INSTALLED
// @react-pdf/pdfkit can CREATE pages; it has no importer for an existing PDF's page
// content. sharp cannot read PDF (no PDFium/poppler in this build). pdf-lib is pure JS —
// no native addon, no wasm, no install script, no eval — so it cannot repeat either of
// the CSP traps in CLAUDE.md and it is safe on Vercel.
//
// THE GOVERNING RULE: THE REPORT ALWAYS DELIVERS. A corrupt, encrypted, oversized or
// non-PDF attachment degrades to a separator page that SAYS SO, in full sentences, in
// the document the client receives. It never 500s the route. That is not the "silently
// resolving delivery" CLAUDE.md warns about (that rule is about lib/pdf/deliver.ts
// resolving void having written nothing) — this degradation is printed, and read.
//
// checklist_templates.pdf_embed_attachments, migration 202.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { COMPANY } from '@/lib/company'

/** One planned attachment, in CHECKLIST order.
 *
 *  `bytes` is null when it could not be fetched; `reason` is set the moment anything goes
 *  wrong. The `number` is assigned BEFORE any of that and never changes — a separator
 *  page is emitted either way, so numbering never shifts and the in-body
 *  "see Attachment N" cross-reference stays true even for a failed attachment. */
export type AttachmentPlan = {
  /** 1-based, in checklist order. */
  number: number
  /** As uploaded, e.g. 'M.V. Navigator - Crew List.pdf'. */
  filename: string
  /** The item the document answers, e.g. '6.9'. */
  itemNumber: string | null
  /** The question's label with any trailing "— attach" stripped. */
  title: string
  storagePath: string
  bytes: Uint8Array | null
  /** Set ⇒ degraded; printed on the separator page instead of the pages. */
  reason: string | null
}

// The merged report has to stay emailable (~25 MB on Gmail/Outlook) and shareable from
// an iPhone, and the report itself already carries inline photos. The job-photos bucket
// caps every file at 25 MB (migration 033 set the size; migration 196 only widened the
// mime list to admit a PDF) — so one file is bounded, but the SUM is not, and neither is
// the COUNT: an "attach" question is an ordinary photo field and takes as many files as
// the surveyor gives it. These caps are what bounds the sum.
//
// EXPORTED because the route enforces them BEFORE the bytes land (it checks
// Content-Length and cancels the body unread) — otherwise twenty 25 MB attachments are
// pulled into the function in full and only THEN rejected here. This module stays the
// authority: the route only declines to pay for what this function is going to refuse.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024   // 10 MB per attachment
export const MAX_TOTAL_BYTES = 15 * 1024 * 1024        // 15 MB of appended source in total
const MAX_PAGES_PER_ATTACHMENT = 100
const MAX_TOTAL_PAGES = 200
/** Same page size JobPDF renders at, so a reader paging through never sees the report
 *  itself appear to change shape. */
const LETTER: [number, number] = [612, 792]

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`

/** The degrade wording, in one place.
 *
 *  A given attachment can be refused either HERE (the bytes arrived and were measured)
 *  or in the route (Content-Length said so and the body was never read). The separator
 *  page must read the same either way — the reader has no idea which of the two happened
 *  and should not be able to tell. */
export const ATTACHMENT_REASONS = {
  /** `size` omitted when the length was never known (a chunked response cut off at the cap). */
  tooLarge: (size?: number | null) =>
    typeof size === 'number' ? `is ${mb(size)}, too large to reproduce here.` : 'is too large to reproduce here.',
  totalLimit: 'could not be included — the report had already reached its attachment size limit.',
  unretrievable: 'could not be retrieved from the job record.',
  notPdf: 'is not a PDF and cannot be reproduced here.',
} as const

/** pdf-lib's StandardFonts are WinAnsi-only: an unencodable character makes drawText
 *  THROW, which would take out the separator page for a filename with a curly quote in
 *  it. The route already strips non-ASCII for the Content-Disposition header; do the
 *  same here. */
const ascii = (s: string) => (s ?? '').replace(/[^\x20-\x7E]/g, '').trim()

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(next, size) > maxWidth && line) { out.push(line); line = word }
    else line = next
  }
  if (line) out.push(line)
  return out
}

/** The exhibit divider that precedes each appended document.
 *
 *  It earns its page: it names the document AND the item it belongs to (the crew list
 *  must be identifiable as the crew list), it re-establishes LETTER portrait between two
 *  third-party page sizes, and it is the only place a FAILED attachment can be reported.
 *
 *  The footer's CENTRE slot is deliberately left empty. @react-pdf's "Page X of Y" counts
 *  only the rendered report, so the body will read "Page 12 of 12" in a 17-page file —
 *  correct as written, because the appended sheets are exhibits. Leaving the centre blank
 *  is what stops this block appearing to continue that numbering. Do NOT "fix" it by
 *  stamping page numbers on the copied pages: drawing onto a third party's page of
 *  unknown geometry risks covering their content. */
function drawSeparator(
  page: PDFPage,
  a: AttachmentPlan,
  pageCount: number,
  reg: PDFFont,
  bold: PDFFont,
  reference: string,
) {
  const W = LETTER[0]
  const M = 72
  const CW = W - M * 2
  const centre = (t: string, y: number, f: PDFFont, size: number, color = rgb(0.1, 0.1, 0.1)) => {
    const s = ascii(t)
    if (!s) return
    page.drawText(s, { x: (W - f.widthOfTextAtSize(s, size)) / 2, y, size, font: f, color })
  }

  let y = 560
  centre(`ATTACHMENT ${a.number}`, y, bold, 22); y -= 34
  centre(a.title, y, bold, 14); y -= 20
  if (a.itemNumber) { centre(`Item ${a.itemNumber}`, y, reg, 10, rgb(0.4, 0.4, 0.4)); y -= 28 }
  else y -= 18

  if (a.reason) {
    const red = rgb(0.6, 0.2, 0.2)
    for (const l of wrapText(`${a.filename} ${a.reason}`, reg, 9, CW)) { centre(l, y, reg, 9, red); y -= 12 }
    y -= 4
    centre('The original is held with the job record.', y, reg, 9, red)
  } else {
    const pages = `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`
    for (const l of wrapText(`${a.filename} — ${pages}`, reg, 9, CW)) { centre(l, y, reg, 9, rgb(0.4, 0.4, 0.4)); y -= 12 }
  }

  // Same wording as the report's own footer (JobPDF.tsx).
  const foot = rgb(0.45, 0.45, 0.45)
  page.drawText(ascii(`${COMPANY.name} — ${COMPANY.confidential}`), { x: M, y: 30, size: 7, font: reg, color: foot })
  const ref = ascii(reference)
  if (ref) page.drawText(ref, { x: W - M - reg.widthOfTextAtSize(ref, 7), y: 30, size: 7, font: reg, color: foot })
}

/**
 * Append each attachment to the END of the rendered report, behind a separator page.
 *
 * NEVER THROWS. A per-attachment failure degrades to a separator page that says why; a
 * failure of the merge itself returns the ORIGINAL report bytes untouched, so Andrew gets
 * exactly today's report rather than nothing.
 *
 * @param reportBytes  the buffer renderToBuffer produced — copied, never re-rendered.
 * @param plan         attachments in checklist order, already downloaded (or marked).
 * @param reference    the job/report number for the separator footers.
 * @param jobId        for log lines only.
 */
export async function mergeAttachments(
  reportBytes: Uint8Array,
  plan: AttachmentPlan[],
  reference: string,
  jobId: string,
): Promise<Uint8Array> {
  if (plan.length === 0) return reportBytes
  try {
    const out = await PDFDocument.load(reportBytes)
    const reg = await out.embedFont(StandardFonts.Helvetica)
    const bold = await out.embedFont(StandardFonts.HelveticaBold)
    let spentBytes = 0
    let spentPages = 0

    for (const a of plan) {
      let copied: PDFPage[] = []
      let reason = a.reason

      if (!reason && a.bytes) {
        try {
          if (a.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
            reason = ATTACHMENT_REASONS.tooLarge(a.bytes.byteLength)
          } else if (spentBytes + a.bytes.byteLength > MAX_TOTAL_BYTES) {
            reason = ATTACHMENT_REASONS.totalLimit
          } else if (Buffer.from(a.bytes.subarray(0, 5)).toString('latin1') !== '%PDF-') {
            // MAGIC BYTES, not the extension. The bucket only allows PDFs (migration 196)
            // but a renamed or legacy file must not reach the parser and throw something
            // that reads like a bug in us.
            reason = ATTACHMENT_REASONS.notPdf
          } else {
            // ignoreEncryption is deliberately NOT set. Letting an encrypted file through
            // produces garbled or blank pages that look like a rendering fault; the throw
            // is what lets the separator state the true reason.
            const src = await PDFDocument.load(a.bytes)
            const idx = src.getPageIndices()
            if (idx.length === 0) {
              reason = 'contains no pages.'
            } else if (idx.length > MAX_PAGES_PER_ATTACHMENT) {
              reason = `has ${idx.length} pages, too many to reproduce here.`
            } else if (spentPages + idx.length > MAX_TOTAL_PAGES) {
              reason = 'could not be included — the report had already reached its attachment page limit.'
            } else {
              // copyPages, NOT embedPage. copyPages preserves the page dictionary whole —
              // annotations, /Rotate, /UserUnit and selectable vector text (which matters
              // for a crew list) — at its native size. embedPage would drop widget
              // annotations (an unflattened AcroForm crew list would arrive BLANK) and
              // ignore /Rotate (a scanned page would arrive sideways). Mixed page sizes
              // in one file are legal; every viewer fits each page to the window.
              copied = await out.copyPages(src, idx)
              spentBytes += a.bytes.byteLength
              spentPages += idx.length
            }
          }
        } catch (e) {
          reason = (e as Error)?.name === 'EncryptedPDFError'
            ? 'is password-protected and cannot be reproduced here.'
            : 'could not be read — the file may be damaged.'
          copied = []
        }
      }

      if (reason) console.error('[pdf:attach]', jobId, a.storagePath, reason)

      const sep = out.addPage(LETTER)
      drawSeparator(sep, { ...a, reason }, copied.length, reg, bold, reference)
      for (const pg of copied) out.addPage(pg)
    }

    return await out.save()
  } catch (e) {
    // Our own report failed to load or save. Ship today's report rather than nothing —
    // the in-body lines still name documents that are held with the job record.
    console.error('[pdf:attach:merge]', jobId, e)
    return reportBytes
  }
}
