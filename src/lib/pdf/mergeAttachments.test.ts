// mergeAttachments must NEVER throw. The report always delivers: a corrupt, encrypted,
// oversized or non-PDF attachment degrades to a separator page that says so, and a
// failure of the merge itself returns the original report bytes untouched.
//
// No network: the "report" and the "attachments" are both built with pdf-lib here.
import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { mergeAttachments, type AttachmentPlan } from './mergeAttachments'

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([612, 792])
    p.drawText(`page ${i + 1}`, { x: 72, y: 700, size: 12, font })
  }
  return doc.save()
}

const countPages = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount()

const plan = (over: Partial<AttachmentPlan> = {}): AttachmentPlan => ({
  number: 1,
  filename: 'M.V. Navigator - Crew List.pdf',
  itemNumber: '6.9',
  title: 'Crew list',
  storagePath: 'job/crew.pdf',
  bytes: null,
  reason: null,
  ...over,
})

describe('mergeAttachments', () => {
  it('returns the input untouched when there is nothing to append', async () => {
    const report = await makePdf(3)
    const out = await mergeAttachments(report, [], '26-08-263', 'job-1')
    expect(out).toBe(report)   // identity, not just equality: nothing was re-serialised
  })

  it('appends a separator page plus every source page', async () => {
    const report = await makePdf(3)
    const attachment = await makePdf(2)
    const out = await mergeAttachments(report, [plan({ bytes: attachment })], '26-08-263', 'job-1')
    // 3 report + 1 separator + 2 source
    expect(await countPages(out)).toBe(6)
  })

  it('numbers attachments in the order given, one separator each', async () => {
    const report = await makePdf(1)
    const a = await makePdf(3)
    const b = await makePdf(1)
    const out = await mergeAttachments(report, [
      plan({ number: 1, bytes: a, filename: 'Spec Sheet.pdf', title: "Ship's particulars", itemNumber: '2.11' }),
      plan({ number: 2, bytes: b }),
    ], '26-08-263', 'job-1')
    // 1 + (1 + 3) + (1 + 1)
    expect(await countPages(out)).toBe(7)
  })

  it('degrades a corrupt attachment to a separator page instead of throwing', async () => {
    const report = await makePdf(2)
    const junk = new Uint8Array(Buffer.from('%PDF-1.7 this is not actually a pdf', 'latin1'))
    const out = await mergeAttachments(report, [plan({ bytes: junk })], '26-08-263', 'job-1')
    expect(await countPages(out)).toBe(3)   // 2 report + 1 separator, no source pages
  })

  it('degrades a non-PDF by MAGIC BYTES, not by its .pdf extension', async () => {
    const report = await makePdf(2)
    const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])   // a zip, i.e. .docx
    const out = await mergeAttachments(report, [plan({ bytes: docx })], '26-08-263', 'job-1')
    expect(await countPages(out)).toBe(3)
  })

  it('degrades a file that could not be downloaded, keeping its number', async () => {
    const report = await makePdf(2)
    const ok = await makePdf(1)
    const out = await mergeAttachments(report, [
      plan({ number: 1, reason: 'could not be retrieved from the job record.' }),
      plan({ number: 2, bytes: ok }),
    ], '26-08-263', 'job-1')
    // 2 report + 1 separator (failed, no pages) + 1 separator + 1 source
    expect(await countPages(out)).toBe(5)
  })

  it('refuses an attachment over the per-file size cap', async () => {
    const report = await makePdf(1)
    const huge = new Uint8Array(11 * 1024 * 1024)
    huge.set(Buffer.from('%PDF-', 'latin1'), 0)
    const out = await mergeAttachments(report, [plan({ bytes: huge })], '26-08-263', 'job-1')
    expect(await countPages(out)).toBe(2)   // separator only
  })

  it('returns the ORIGINAL report when the merge itself cannot run', async () => {
    const notAPdf = new Uint8Array(Buffer.from('this is not a report at all', 'latin1'))
    const attachment = await makePdf(1)
    const out = await mergeAttachments(notAPdf, [plan({ bytes: attachment })], '26-08-263', 'job-1')
    expect(Buffer.from(out).equals(Buffer.from(notAPdf))).toBe(true)
  })
})
