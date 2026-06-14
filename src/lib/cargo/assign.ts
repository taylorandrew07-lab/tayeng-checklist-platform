// Bulk-photo auto-assignment. Given the files dropped for one date+period, work out
// each photo's hold number + camera (forward/aft) and its actual capture time.
// Confidence ladder: filename recognition → EXIF capture time (for the actual time
// and ordering) → upload order. Anything ambiguous is left UNASSIGNED for the
// surveyor to place manually — auto-assignment never finalizes a set.

// exifr is loaded on demand inside exifCaptureTime so it only downloads when a
// surveyor actually bulk-uploads photos, not on cargo-workspace open.
import type { Camera } from './types'

export interface AssignResult {
  file: File
  holdNumber: number | null
  camera: Camera | null
  actualTime: string | null // "HH:mm"
  assigned: boolean
}

// Hold number: "Hold 1", "H1", "No1 Hold", "No.1", "Cargo Hold 1", "CH1", "#1".
// We deliberately try the most explicit patterns first.
const HOLD_PATTERNS: RegExp[] = [
  /(?:cargo\s*)?hold\s*[_\-#]?\s*(\d{1,2})/i,
  /\bno\.?\s*(\d{1,2})\s*hold/i,
  /\bch\s*[_\-#]?\s*(\d{1,2})\b/i,
  /\bh\s*[_\-#]?\s*(\d{1,2})\b/i,
  /(?:^|[_\-#\s])(\d{1,2})(?=[_\-\s]*(?:f(?:wd|ore|orward)?|a(?:ft|fter)))/i,
]

const FWD_PATTERN = /\b(fwd|fore|forward)\b|(?:^|[_\-\s])(fwd|fore|forward)/i
const AFT_PATTERN = /\b(aft|after)\b|(?:^|[_\-\s])(aft|after)/i

function parseHoldNumber(name: string): number | null {
  for (const re of HOLD_PATTERNS) {
    const m = name.match(re)
    if (m) {
      const n = parseInt(m[1], 10)
      if (!isNaN(n) && n >= 1 && n <= 99) return n
    }
  }
  return null
}

function parseCamera(name: string): Camera | null {
  // Check AFT before FWD: "after" must not be misread, and "fwd"/"aft" are distinct.
  if (AFT_PATTERN.test(name)) return 'aft'
  if (FWD_PATTERN.test(name)) return 'fwd'
  return null
}

function toHHmm(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** Best-effort EXIF capture time; resolves null if absent/unreadable. */
async function exifCaptureTime(file: File): Promise<Date | null> {
  try {
    const { default: exifr } = await import('exifr')
    const data = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate', 'ModifyDate'])
    const raw = data?.DateTimeOriginal ?? data?.CreateDate ?? data?.ModifyDate
    if (raw instanceof Date && !isNaN(raw.getTime())) return raw
    if (typeof raw === 'string') {
      const d = new Date(raw)
      if (!isNaN(d.getTime())) return d
    }
  } catch {
    /* no EXIF — fall back to upload order */
  }
  return null
}

/**
 * Assign a batch of files for a single monitoring period.
 * @param files the dropped files, in selection order.
 * @param holdCount the voyage hold count — a parsed hold outside 1..holdCount is
 *        treated as unrecognized and left unassigned.
 */
export async function autoAssign(files: File[], holdCount: number): Promise<AssignResult[]> {
  const captured = await Promise.all(files.map(exifCaptureTime))

  return files.map((file, i): AssignResult => {
    const name = file.name
    const holdNumber = parseHoldNumber(name)
    const camera = parseCamera(name)
    const time = captured[i]
    const inRange = holdNumber != null && holdNumber >= 1 && holdNumber <= holdCount
    const assigned = inRange && camera != null
    return {
      file,
      holdNumber: assigned ? holdNumber : null,
      camera: assigned ? camera : null,
      actualTime: time ? toHHmm(time) : null,
      assigned,
    }
  })
}
